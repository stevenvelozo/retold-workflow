'use strict';

/**
 * retold-workflow - Workflow-Type-Catalog tests
 *
 * The catalog is exercised against a small in-memory store standing in for a product's
 * tenant-bound persistence. The point is that the catalog logic (union list, lazy clone,
 * provenance, drift) is correct without any database, framework, or product schema.
 */

const libAssert = require('node:assert');
const libWorkflowTypeCatalog = require('../source/Workflow-Type-Catalog.js');

// An in-memory store bound to a single tenant. Returns shallow copies on read (a real
// store hands back fresh rows), which is enough to prove the catalog deep-copies on clone.
class MemoryStore
{
	constructor()
	{
		this.builtIns = [];
		this.owned = [];
		this._seq = 0;
	}

	seedBuiltIn(pRecord)
	{
		let tmpRecord = Object.assign({ ID: 'b' + (++this._seq) }, pRecord);
		this.builtIns.push(tmpRecord);
		return tmpRecord;
	}

	async listBuiltIns() { return this.builtIns.map((pRow) => Object.assign({}, pRow)); }
	async getBuiltIn(pID) { let tmpRow = this.builtIns.find((pRow) => pRow.ID === pID); return tmpRow ? Object.assign({}, tmpRow) : null; }
	async listOwnedTypes() { return this.owned.map((pRow) => Object.assign({}, pRow)); }
	async findCloneOfBuiltIn(pID) { let tmpRow = this.owned.find((pRow) => pRow.SourceID === pID); return tmpRow ? Object.assign({}, tmpRow) : null; }
	async createOwnedType(pRecord) { let tmpRow = Object.assign({ ID: 'o' + (++this._seq) }, pRecord); this.owned.push(tmpRow); return Object.assign({}, tmpRow); }
}

function softwareBuiltIn()
{
	return {
		TypeKey: 'software',
		Name: 'Software',
		Description: 'Software delivery lifecycle',
		Version: 1,
		WorkflowDefinition: { Key: 'software', States: [{ Key: 'backlog' }, { Key: 'done' }] },
		MetadataManifest: { Fields: [{ Address: 'PR.Approved', Type: 'boolean' }] }
	};
}

suite('retold-workflow: WorkflowTypeCatalog', () =>
{
	suite('Construction', () =>
	{
		test('requires a store', () =>
		{
			libAssert.throws(() => new libWorkflowTypeCatalog(), /requires a store/);
		});
	});

	suite('Union list', () =>
	{
		test('labels built-ins and owned, with no adoption yet', async () =>
		{
			let tmpStore = new MemoryStore();
			tmpStore.seedBuiltIn(softwareBuiltIn());
			let tmpCatalog = new libWorkflowTypeCatalog(tmpStore);

			let tmpList = await tmpCatalog.unionList();
			libAssert.strictEqual(tmpList.length, 1);
			libAssert.strictEqual(tmpList[0].Origin, 'builtin');
			libAssert.strictEqual(tmpList[0].AdoptedAsID, null);
			libAssert.strictEqual(tmpList[0].TypeKey, 'software');
		});

		test('after adoption the built-in row points at its clone', async () =>
		{
			let tmpStore = new MemoryStore();
			let tmpBuiltIn = tmpStore.seedBuiltIn(softwareBuiltIn());
			let tmpCatalog = new libWorkflowTypeCatalog(tmpStore);

			let tmpClone = await tmpCatalog.adoptBuiltIn(tmpBuiltIn.ID);
			let tmpList = await tmpCatalog.unionList();

			let tmpBuiltInRow = tmpList.find((pRow) => pRow.Origin === 'builtin');
			let tmpOwnedRow = tmpList.find((pRow) => pRow.Origin === 'owned');
			libAssert.strictEqual(tmpBuiltInRow.AdoptedAsID, tmpClone.ID);
			libAssert.ok(tmpOwnedRow, 'the owned clone is listed');
			libAssert.strictEqual(tmpOwnedRow.SourceID, tmpBuiltIn.ID);
		});
	});

	suite('Adopt a built-in (lazy, idempotent clone)', () =>
	{
		test('creates a clone with provenance stamped', async () =>
		{
			let tmpStore = new MemoryStore();
			let tmpBuiltIn = tmpStore.seedBuiltIn(softwareBuiltIn());
			let tmpCatalog = new libWorkflowTypeCatalog(tmpStore);

			let tmpClone = await tmpCatalog.adoptBuiltIn(tmpBuiltIn.ID);
			libAssert.strictEqual(tmpClone.Origin, 'owned');
			libAssert.strictEqual(tmpClone.SourceID, tmpBuiltIn.ID);
			libAssert.strictEqual(tmpClone.SourceVersion, 1);
			libAssert.strictEqual(tmpClone.TypeKey, 'software');
			libAssert.deepStrictEqual(tmpClone.WorkflowDefinition, tmpBuiltIn.WorkflowDefinition);
			libAssert.strictEqual(tmpStore.owned.length, 1);
		});

		test('a second adopt returns the same clone (find-or-create)', async () =>
		{
			let tmpStore = new MemoryStore();
			let tmpBuiltIn = tmpStore.seedBuiltIn(softwareBuiltIn());
			let tmpCatalog = new libWorkflowTypeCatalog(tmpStore);

			let tmpFirst = await tmpCatalog.adoptBuiltIn(tmpBuiltIn.ID);
			let tmpSecond = await tmpCatalog.adoptBuiltIn(tmpBuiltIn.ID);
			libAssert.strictEqual(tmpFirst.ID, tmpSecond.ID);
			libAssert.strictEqual(tmpStore.owned.length, 1);
		});

		test('the clone deep-copies the definition (independent of the built-in)', async () =>
		{
			let tmpStore = new MemoryStore();
			let tmpBuiltIn = tmpStore.seedBuiltIn(softwareBuiltIn());
			let tmpCatalog = new libWorkflowTypeCatalog(tmpStore);

			await tmpCatalog.adoptBuiltIn(tmpBuiltIn.ID);
			// Mutate the stored built-in after the clone exists.
			tmpStore.builtIns[0].WorkflowDefinition.States.push({ Key: 'injected' });

			let tmpClone = await tmpStore.findCloneOfBuiltIn(tmpBuiltIn.ID);
			libAssert.strictEqual(tmpClone.WorkflowDefinition.States.length, 2, 'clone unchanged by built-in mutation');
		});

		test('adopting an unknown built-in throws', async () =>
		{
			let tmpStore = new MemoryStore();
			let tmpCatalog = new libWorkflowTypeCatalog(tmpStore);
			await libAssert.rejects(() => tmpCatalog.adoptBuiltIn('nope'), /no built-in workflow type/);
		});
	});

	suite('Drift', () =>
	{
		test('a fresh clone has not drifted', async () =>
		{
			let tmpStore = new MemoryStore();
			let tmpBuiltIn = tmpStore.seedBuiltIn(softwareBuiltIn());
			let tmpCatalog = new libWorkflowTypeCatalog(tmpStore);

			let tmpClone = await tmpCatalog.adoptBuiltIn(tmpBuiltIn.ID);
			let tmpDrift = await tmpCatalog.driftStatus(tmpClone);
			libAssert.strictEqual(tmpDrift.Drifted, false);
		});

		test('bumping the built-in version drifts the clone', async () =>
		{
			let tmpStore = new MemoryStore();
			let tmpBuiltIn = tmpStore.seedBuiltIn(softwareBuiltIn());
			let tmpCatalog = new libWorkflowTypeCatalog(tmpStore);

			let tmpClone = await tmpCatalog.adoptBuiltIn(tmpBuiltIn.ID);
			tmpStore.builtIns[0].Version = 2;

			let tmpDrift = await tmpCatalog.driftStatus(tmpClone);
			libAssert.strictEqual(tmpDrift.Drifted, true);
			libAssert.strictEqual(tmpDrift.FromVersion, 1);
			libAssert.strictEqual(tmpDrift.ToVersion, 2);
		});

		test('an authored type (no source) never drifts', async () =>
		{
			let tmpStore = new MemoryStore();
			let tmpCatalog = new libWorkflowTypeCatalog(tmpStore);
			let tmpDrift = await tmpCatalog.driftStatus({ ID: 'o9', TypeKey: 'custom', SourceID: null });
			libAssert.strictEqual(tmpDrift.Drifted, false);
		});
	});
});
