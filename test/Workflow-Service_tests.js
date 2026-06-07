'use strict';

/**
 * retold-workflow - WorkflowService tests
 *
 * The service is exercised against in-memory event and projection stores standing in for a
 * product's persistence. The point is that the service holds no state of its own: a second
 * service instance built over the same stores sees the same subject, because the log is the
 * source of truth and the engine is rebuilt from it on every call.
 */

const libAssert = require('node:assert');
const libRetoldWorkflow = require('../source/Retold-Workflow.js');
const libWorkflowService = libRetoldWorkflow.WorkflowService;

// A deploy-pipeline definition (config). The service never names these fields.
function deployDefinition()
{
	return {
		Key: 'deploy',
		Name: 'Deploy',
		States: [ { Key: 'queued', IsInitial: true }, { Key: 'building' }, { Key: 'review' }, { Key: 'deployed', IsTerminal: true } ],
		Transitions:
		[
			{ From: 'queued', To: 'building', RequiresEntitlement: 'build', Guard: { address: 'Change.HasTests', op: '==', value: true } },
			{ From: 'building', To: 'review', RequiresEntitlement: 'build' },
			{ From: 'review', To: 'deployed', RequiresEntitlement: 'deploy', Guard: { address: 'Change.Approved', op: '==', value: true } },
			{ From: 'review', To: 'building', RequiresEntitlement: 'deploy' }
		]
	};
}

class MemoryEventStore
{
	constructor() { this.logs = {}; }
	async listEvents(pID) { return (this.logs[pID] || []).map((pEvent) => Object.assign({}, pEvent)); }
	async appendEvents(pID, pEvents) { if (!this.logs[pID]) { this.logs[pID] = []; } pEvents.forEach((pEvent) => this.logs[pID].push(Object.assign({}, pEvent))); }
}

class MemoryProjectionStore
{
	constructor() { this.snaps = {}; }
	async saveSnapshot(pID, pSnap) { this.snaps[pID] = pSnap; }
	async subjectsForActor(pActor) { return Object.keys(this.snaps).filter((pID) => libWorkflowService.actorCanAct(this.snaps[pID], pActor)); }
}

function makeService(pChanges, pClock, pEventStore, pProjectionStore)
{
	return new libWorkflowService(
		{
			eventStore: pEventStore,
			projectionStore: pProjectionStore,
			now: () => pClock.t,
			contextResolver: (pID) => ({ Change: pChanges[pID] }),
			definitionResolver: () => deployDefinition()
		});
}

suite
(
	'retold-workflow: WorkflowService',
	() =>
	{
		test('requires the core stores and resolvers', () =>
		{
			libAssert.throws(() => new libWorkflowService({}), /eventStore/);
			libAssert.throws(() => new libWorkflowService({ eventStore: {} }), /contextResolver/);
			libAssert.throws(() => new libWorkflowService({ eventStore: {}, contextResolver: () => ({}) }), /definitionResolver/);
		});

		test('open persists the log and lands in the initial state', async () =>
		{
			let tmpEvents = new MemoryEventStore();
			let tmpService = makeService({ c1: { HasTests: false } }, { t: 0 }, tmpEvents, new MemoryProjectionStore());
			let tmpState = await tmpService.open('c1', { ID: 'jan', Entitlements: ['build'] }, 0);
			libAssert.deepStrictEqual(tmpState.CurrentStates, ['queued']);
			let tmpLog = await tmpEvents.listEvents('c1');
			libAssert.ok(tmpLog.length >= 2, 'opened + state.enter persisted');
		});

		test('a guard blocks, then reevaluate plus advance moves and persists', async () =>
		{
			let tmpChanges = { c1: { HasTests: false } };
			let tmpService = makeService(tmpChanges, { t: 0 }, new MemoryEventStore(), new MemoryProjectionStore());
			await tmpService.open('c1', { ID: 'jan', Entitlements: ['build'] }, 0);

			let tmpBlocked = await tmpService.advance('c1', 'building', { ID: 'jan', Entitlements: ['build'] }, 100);
			libAssert.strictEqual(tmpBlocked.ok, false);

			tmpChanges.c1.HasTests = true;
			await tmpService.reevaluate('c1', 200);
			let tmpReady = await tmpService.advance('c1', 'building', { ID: 'jan', Entitlements: ['build'] }, 300);
			libAssert.strictEqual(tmpReady.ok, true);
			libAssert.deepStrictEqual((await tmpService.getState('c1')).CurrentStates, ['building']);
		});

		test('a second service over the same stores sees the same subject (stateless)', async () =>
		{
			let tmpChanges = { c1: { HasTests: true, Approved: true } };
			let tmpEvents = new MemoryEventStore();
			let tmpProjections = new MemoryProjectionStore();
			let tmpFirst = makeService(tmpChanges, { t: 0 }, tmpEvents, tmpProjections);
			await tmpFirst.open('c1', { ID: 'jan', Entitlements: ['build'] }, 0);
			await tmpFirst.advance('c1', 'building', { ID: 'jan', Entitlements: ['build'] }, 1000);
			await tmpFirst.advance('c1', 'review', { ID: 'jan', Entitlements: ['build'] }, 2000);

			// a brand-new service instance, as if a different request or process
			let tmpSecond = makeService(tmpChanges, { t: 0 }, tmpEvents, tmpProjections);
			libAssert.deepStrictEqual((await tmpSecond.getState('c1')).CurrentStates, ['review']);
			let tmpMetrics = await tmpSecond.getMetrics('c1');
			libAssert.strictEqual(tmpMetrics.StateTime.queued, 1000);
			libAssert.strictEqual(tmpMetrics.StateTime.building, 1000);
		});

		test('agency: whoCanActOn per subject, whatCanAdvance via the projection store', async () =>
		{
			let tmpChanges = { c1: { HasTests: true, Approved: true }, c2: { HasTests: true, Approved: false } };
			let tmpEvents = new MemoryEventStore();
			let tmpProjections = new MemoryProjectionStore();
			let tmpService = makeService(tmpChanges, { t: 0 }, tmpEvents, tmpProjections);

			for (let pID of ['c1', 'c2'])
			{
				await tmpService.open(pID, { ID: 'jan', Entitlements: ['build'] }, 0);
				await tmpService.advance(pID, 'building', { ID: 'jan', Entitlements: ['build'] }, 100);
				await tmpService.advance(pID, 'review', { ID: 'jan', Entitlements: ['build'] }, 200);
			}

			let tmpDeployer = { ID: 'deb', Entitlements: ['deploy'] };
			let tmpC1Exits = (await tmpService.whoCanActOn('c1')).map((pExit) => pExit.ToState);
			libAssert.ok(tmpC1Exits.indexOf('deployed') >= 0, 'c1 is approved, so the deploy exit is ready');

			let tmpAdvanceable = await tmpService.whatCanAdvance(tmpDeployer);
			libAssert.ok(tmpAdvanceable.indexOf('c1') >= 0, 'deployer can deploy c1');
			libAssert.ok(tmpAdvanceable.indexOf('c2') >= 0, 'deployer can reject c2 back to building');
		});

		test('whatCanAdvance needs a projection store', async () =>
		{
			let tmpService = new libWorkflowService({ eventStore: new MemoryEventStore(), contextResolver: () => ({}), definitionResolver: () => deployDefinition() });
			await libAssert.rejects(() => tmpService.whatCanAdvance({ ID: 'x', Entitlements: [] }), /projectionStore/);
		});
	}
);
