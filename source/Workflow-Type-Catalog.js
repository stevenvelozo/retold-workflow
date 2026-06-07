'use strict';

/**
 * Workflow-Type-Catalog
 *
 * The reusable built-in / clone type catalog, with provenance and drift, over an
 * injected store. The store is the only coupling to a product's schema and tenancy:
 * retold-workflow never names a table or a customer. A product hands in a store that
 * is already bound to the current tenant, and this class adds the generic behavior.
 *
 * Two kinds of type live in the catalog:
 *   - built-in: platform-owned archetypes (Software, Recipe, ...). Read-only, versioned.
 *   - owned:    a tenant's own types. Either authored, or a deep clone of a built-in
 *               that records where it came from (SourceID + SourceVersion).
 *
 * Adopting a built-in is lazy and idempotent: the first time a tenant picks one it is
 * deep-cloned into an owned type; later picks of the same built-in return that one clone.
 *
 * Expected store interface (all Promise-returning), already bound to the current tenant:
 *   listBuiltIns()              -> [typeRecord]
 *   getBuiltIn(pBuiltInID)      -> typeRecord | null
 *   listOwnedTypes()            -> [typeRecord]
 *   findCloneOfBuiltIn(pID)     -> typeRecord | null
 *   createOwnedType(pRecord)    -> typeRecord (the persisted row, with its new ID)
 *
 * A typeRecord is a plain object carrying at least:
 *   { ID, TypeKey, Name, Description, Version, WorkflowDefinition, MetadataManifest,
 *     SourceID, SourceVersion }
 * ID and SourceID are opaque here. WorkflowDefinition and MetadataManifest are arbitrary
 * JSON the engine layer consumes; this class copies them verbatim and never inspects them.
 *
 * @author Steven Velozo <steven@velozo.com>
 * @license MIT
 */

const ORIGIN_BUILTIN = 'builtin';
const ORIGIN_OWNED = 'owned';

class WorkflowTypeCatalog
{
	constructor(pStore)
	{
		if (!pStore) { throw new Error('WorkflowTypeCatalog requires a store'); }
		this.store = pStore;
	}

	/**
	 * The picker list: built-ins (labeled) plus the tenant's own types. A built-in the
	 * tenant has already adopted carries AdoptedAsID pointing at its clone, so a product
	 * can show "already in use" instead of offering a second copy.
	 */
	async unionList()
	{
		let tmpBuiltIns = (await this.store.listBuiltIns()) || [];
		let tmpOwned = (await this.store.listOwnedTypes()) || [];

		let tmpOwnedBySource = {};
		tmpOwned.forEach((pType) => { if (pType.SourceID != null) { tmpOwnedBySource[pType.SourceID] = pType; } });

		let tmpList = [];
		tmpBuiltIns.forEach((pType) =>
		{
			let tmpClone = tmpOwnedBySource[pType.ID];
			tmpList.push(Object.assign({}, pType, { Origin: ORIGIN_BUILTIN, AdoptedAsID: tmpClone ? tmpClone.ID : null }));
		});
		tmpOwned.forEach((pType) =>
		{
			tmpList.push(Object.assign({}, pType, { Origin: ORIGIN_OWNED }));
		});
		return tmpList;
	}

	/** The tenant's own types only. */
	async ownedTypes()
	{
		let tmpOwned = (await this.store.listOwnedTypes()) || [];
		return tmpOwned.map((pType) => Object.assign({}, pType, { Origin: ORIGIN_OWNED }));
	}

	/**
	 * Adopt a built-in: find-or-create the tenant's clone of it. Idempotent, so a second
	 * call for the same built-in returns the same clone. Returns the owned typeRecord.
	 */
	async adoptBuiltIn(pBuiltInID)
	{
		let tmpExisting = await this.store.findCloneOfBuiltIn(pBuiltInID);
		if (tmpExisting) { return Object.assign({}, tmpExisting, { Origin: ORIGIN_OWNED }); }

		let tmpBuiltIn = await this.store.getBuiltIn(pBuiltInID);
		if (!tmpBuiltIn) { throw new Error('no built-in workflow type with id "' + pBuiltInID + '"'); }

		let tmpClone =
		{
			TypeKey: tmpBuiltIn.TypeKey,
			Name: tmpBuiltIn.Name,
			Description: tmpBuiltIn.Description,
			WorkflowDefinition: _deepCopy(tmpBuiltIn.WorkflowDefinition),
			MetadataManifest: _deepCopy(tmpBuiltIn.MetadataManifest),
			SourceID: tmpBuiltIn.ID,
			SourceVersion: tmpBuiltIn.Version
		};
		let tmpCreated = await this.store.createOwnedType(tmpClone);
		return Object.assign({}, tmpCreated, { Origin: ORIGIN_OWNED });
	}

	/**
	 * Drift of an owned type against the built-in it was cloned from. Returns
	 * { Drifted, SourceID, FromVersion, ToVersion }. Drifted is false for a type with no
	 * source (authored from scratch) or whose source built-in version is unchanged.
	 */
	async driftStatus(pOwnedType)
	{
		if (!pOwnedType || pOwnedType.SourceID == null)
		{
			return { Drifted: false, SourceID: null, FromVersion: null, ToVersion: null };
		}
		let tmpBuiltIn = await this.store.getBuiltIn(pOwnedType.SourceID);
		if (!tmpBuiltIn)
		{
			return { Drifted: false, SourceID: pOwnedType.SourceID, FromVersion: pOwnedType.SourceVersion, ToVersion: null };
		}
		let tmpDrifted = Number(tmpBuiltIn.Version) > Number(pOwnedType.SourceVersion);
		return { Drifted: tmpDrifted, SourceID: pOwnedType.SourceID, FromVersion: pOwnedType.SourceVersion, ToVersion: tmpBuiltIn.Version };
	}
}

function _deepCopy(pValue)
{
	if (pValue === undefined || pValue === null) { return pValue; }
	return JSON.parse(JSON.stringify(pValue));
}

module.exports = WorkflowTypeCatalog;
module.exports.ORIGIN_BUILTIN = ORIGIN_BUILTIN;
module.exports.ORIGIN_OWNED = ORIGIN_OWNED;
