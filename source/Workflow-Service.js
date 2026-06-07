'use strict';

/**
 * Workflow-Service
 *
 * The product-agnostic core of retold-workflow. It drives a subject through its workflow
 * on top of the fable-workflow engine, but it is stateless and persistence-backed: the
 * event log is the source of truth, and the engine is rebuilt from it for each operation,
 * then discarded. Nothing about a product's schema, tenancy, or storage leaks in;
 * everything arrives through injected, already-tenant-bound interfaces.
 *
 * Injected (constructor config):
 *   eventStore         { listEvents(subjectId) -> [event],
 *                        appendEvents(subjectId, [event]) -> void }       (required)
 *   contextResolver    (subjectId) -> data object (Promise or value)      (required)
 *                        the data a subject's guards address into; fetched once per op
 *   definitionResolver (subjectId) -> WorkflowDefinition (Promise/value)  (required)
 *                        which workflow governs the subject (its type's definition)
 *   projectionStore    { saveSnapshot(subjectId, snapshot) -> void,
 *                        subjectsForActor(actor) -> [subjectId] }         (optional)
 *                        the materialized eligibility that whatCanAdvance reads
 *   now                () -> ms timestamp                                 (optional)
 *   engineClass        a WorkflowEngine class                            (optional)
 *
 * Each write loads the subject's log, fetches its context once, builds a fresh engine,
 * hydrates (or opens), runs the operation, and persists only the new events plus a
 * projection snapshot. Reads hydrate and answer. Because state lives in the stores and
 * not here, the same subject behaves identically whichever process touches it.
 *
 * @author Steven Velozo <steven@velozo.com>
 * @license MIT
 */

const libFableWorkflow = require('fable-workflow');

class WorkflowService
{
	constructor(pConfig)
	{
		let tmpConfig = pConfig || {};
		if (!tmpConfig.eventStore) { throw new Error('WorkflowService requires an eventStore'); }
		if (typeof tmpConfig.contextResolver !== 'function') { throw new Error('WorkflowService requires a contextResolver function'); }
		if (typeof tmpConfig.definitionResolver !== 'function') { throw new Error('WorkflowService requires a definitionResolver function'); }

		this._eventStore = tmpConfig.eventStore;
		this._contextResolver = tmpConfig.contextResolver;
		this._definitionResolver = tmpConfig.definitionResolver;
		this._projectionStore = tmpConfig.projectionStore || null;
		this._now = (typeof tmpConfig.now === 'function') ? tmpConfig.now : (() => Date.now());
		this._EngineClass = tmpConfig.engineClass || libFableWorkflow.WorkflowEngine;
	}

	// -- writes ----------------------------------------------------------------

	async open(pSubjectId, pActor, pAt)
	{
		let tmpExisting = await this._eventStore.listEvents(pSubjectId);
		if (tmpExisting && tmpExisting.length) { throw new Error('subject "' + pSubjectId + '" is already open'); }
		let tmpPrepared = await this._prepareEngine(pSubjectId);
		tmpPrepared.engine.open(pSubjectId, tmpPrepared.definition.Key, pActor, pAt);
		await this._persist(tmpPrepared, pSubjectId, 0);
		return tmpPrepared.engine.getState(pSubjectId);
	}

	async advance(pSubjectId, pToState, pActor, pAt)
	{
		let tmpPrepared = await this._hydrate(pSubjectId);
		let tmpResult = tmpPrepared.engine.advance(pSubjectId, pToState, pActor, pAt);
		if (tmpResult.ok) { await this._persist(tmpPrepared, pSubjectId, tmpPrepared.priorCount); }
		return tmpResult;
	}

	async emit(pSubjectId, pEvent, pAt)
	{
		let tmpPrepared = await this._hydrate(pSubjectId);
		tmpPrepared.engine.emit(pSubjectId, pEvent, pAt);
		await this._persist(tmpPrepared, pSubjectId, tmpPrepared.priorCount);
		return tmpPrepared.engine.getState(pSubjectId);
	}

	async reevaluate(pSubjectId, pAt)
	{
		let tmpPrepared = await this._hydrate(pSubjectId);
		tmpPrepared.engine.reevaluate(pSubjectId, pAt);
		await this._persist(tmpPrepared, pSubjectId, tmpPrepared.priorCount);
		return tmpPrepared.engine.getAvailableExits(pSubjectId);
	}

	// -- reads -----------------------------------------------------------------

	async getState(pSubjectId) { let tmpPrepared = await this._hydrate(pSubjectId); return tmpPrepared.engine.getState(pSubjectId); }
	async getMetrics(pSubjectId) { let tmpPrepared = await this._hydrate(pSubjectId); return tmpPrepared.engine.getMetrics(pSubjectId); }
	async getAvailableExits(pSubjectId) { let tmpPrepared = await this._hydrate(pSubjectId); return tmpPrepared.engine.getAvailableExits(pSubjectId); }
	async whoCanActOn(pSubjectId) { let tmpPrepared = await this._hydrate(pSubjectId); return tmpPrepared.engine.whoCanActOn(pSubjectId); }
	async getTimeline(pSubjectId) { let tmpEvents = await this._eventStore.listEvents(pSubjectId); return tmpEvents || []; }

	/** Cross-subject agency. Delegates to the projection store's indexed query. */
	async whatCanAdvance(pActor)
	{
		if (!this._projectionStore || typeof this._projectionStore.subjectsForActor !== 'function')
		{
			throw new Error('whatCanAdvance requires a projectionStore with a subjectsForActor query');
		}
		return this._projectionStore.subjectsForActor(pActor);
	}

	/**
	 * Whether an actor can take any satisfied exit in a stored snapshot. A projection store
	 * uses this (after its own indexed pre-filter) to answer subjectsForActor, so the agency
	 * rule lives in one place.
	 */
	static actorCanAct(pSnapshot, pActor)
	{
		let tmpActor = pActor || {};
		let tmpEntitlements = tmpActor.Entitlements || [];
		let tmpExits = (pSnapshot && pSnapshot.Eligibility) || [];
		return tmpExits.some((pExit) => pExit.GuardSatisfied
			&& (!pExit.RequiredEntitlement || tmpEntitlements.indexOf(pExit.RequiredEntitlement) >= 0)
			&& (pExit.ResolvedActor == null || pExit.ResolvedActor === tmpActor.ID));
	}

	// -- internals -------------------------------------------------------------

	async _prepareEngine(pSubjectId)
	{
		let tmpDefinition = await this._definitionResolver(pSubjectId);
		if (!tmpDefinition || !tmpDefinition.Key) { throw new Error('no workflow definition for subject "' + pSubjectId + '"'); }
		let tmpContext = (await this._contextResolver(pSubjectId)) || {};
		let tmpEngine = new this._EngineClass({ contextResolver: () => tmpContext, now: this._now });
		tmpEngine.defineWorkflow(tmpDefinition);
		return { engine: tmpEngine, definition: tmpDefinition };
	}

	async _hydrate(pSubjectId)
	{
		let tmpEvents = await this._eventStore.listEvents(pSubjectId);
		if (!tmpEvents || !tmpEvents.length) { throw new Error('subject "' + pSubjectId + '" is not open'); }
		let tmpPrepared = await this._prepareEngine(pSubjectId);
		tmpPrepared.engine.hydrate(pSubjectId, tmpPrepared.definition.Key, tmpEvents);
		tmpPrepared.priorCount = tmpPrepared.engine.getTimeline(pSubjectId).length;
		return tmpPrepared;
	}

	async _persist(pPrepared, pSubjectId, pPriorCount)
	{
		let tmpDelta = pPrepared.engine.getTimeline(pSubjectId).slice(pPriorCount);
		if (tmpDelta.length) { await this._eventStore.appendEvents(pSubjectId, tmpDelta); }
		if (this._projectionStore && typeof this._projectionStore.saveSnapshot === 'function')
		{
			await this._projectionStore.saveSnapshot(pSubjectId,
				{
					State: pPrepared.engine.getState(pSubjectId),
					Metrics: pPrepared.engine.getMetrics(pSubjectId),
					Eligibility: pPrepared.engine.getAvailableExits(pSubjectId)
				});
		}
	}
}

module.exports = WorkflowService;
