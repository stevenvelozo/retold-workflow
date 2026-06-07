# retold-workflow

A reusable, product-agnostic workflow capability for Retold, built on the
[fable-workflow](https://github.com/fable-retold/fable-workflow) engine.

It is the middle of three tiers:

- **fable-workflow** is the pure engine: workflow definitions, an append-only event
  log, folded projections (time metrics and eligibility), guards, and agency queries.
- **retold-workflow** (this module) is the capability built on that engine: a workflow
  service, a built-in/clone type catalog with provenance and drift, and the board,
  timeline, metrics, and agency UI.
- **A product** supplies the concrete wiring: its tables, a few small stores, a context
  resolver over its data, and any seeds.

The reason this is reusable rather than welded into one product is the same discipline
that makes the engine reusable: it depends only on injected interfaces, never on a
product's tables. A product implements an event store, a projection store, a
type-catalog store, and a context resolver over its own schema; a different product
implements the same four and gets the same workflow capability and the same UI, with no
new workflow code. The engine example already runs an editorial review and a hardware
return on one engine; this tier lets a whole product do the same.

## Status

In progress. Phase 1 is in: the type catalog and the workflow service. The UI is next.

## The type catalog

A catalog holds two kinds of workflow type:

- **built-in**: platform-owned archetypes (Software, Recipe, Physical Manufacturing).
  Read-only and versioned.
- **owned**: a tenant's own types, either authored or deep-cloned from a built-in. A
  clone records where it came from, so the platform can evolve a built-in without
  disturbing anyone's running workflows, and a tenant can choose when to take the update.

`WorkflowTypeCatalog` is the generic logic over an injected, tenant-bound store. It does
not name a table or a customer.

```javascript
const { WorkflowTypeCatalog } = require('retold-workflow');

let tmpCatalog = new WorkflowTypeCatalog(myTenantBoundStore);

await tmpCatalog.unionList();        // built-ins (labeled) + this tenant's own types
await tmpCatalog.adoptBuiltIn(id);   // lazy, idempotent: find-or-create the tenant's clone
await tmpCatalog.driftStatus(owned); // has the source built-in moved past this clone?
```

Adopting a built-in is lazy and idempotent: the first time a tenant picks one it is
deep-cloned into an owned type stamped with its source and version; later picks of the
same built-in return that one clone.

### The store interface

A product implements this, already bound to the current tenant (all Promise-returning):

```
listBuiltIns()            -> [typeRecord]
getBuiltIn(id)            -> typeRecord | null
listOwnedTypes()          -> [typeRecord]
findCloneOfBuiltIn(id)    -> typeRecord | null
createOwnedType(record)   -> typeRecord
```

A `typeRecord` carries at least `{ ID, TypeKey, Name, Description, Version,
WorkflowDefinition, MetadataManifest, SourceID, SourceVersion }`. `WorkflowDefinition`
and `MetadataManifest` are arbitrary JSON the engine layer consumes; the catalog copies
them verbatim and never inspects them.

## The workflow service

`WorkflowService` drives a subject through its workflow, but it holds no state of its own.
The event log is the source of truth: every call loads the subject's log, rebuilds the
engine from it by replaying that log, runs the operation, and persists only the new events
plus a projection snapshot. A second service instance over the same stores sees the same
subject, which is what makes it safe behind a stateless server.

```javascript
const { WorkflowService } = require('retold-workflow');

let tmpService = new WorkflowService(
	{
		eventStore,          // listEvents(id) / appendEvents(id, events)
		contextResolver,     // (id) -> the data the subject's guards address into
		definitionResolver,  // (id) -> the workflow definition that governs the subject
		projectionStore      // optional: saveSnapshot(id, snap) / subjectsForActor(actor)
	});

await tmpService.open(id, actor);
await tmpService.advance(id, 'review', actor);   // { ok, reason?, state? }, under role and data gates
await tmpService.reevaluate(id);                 // after the subject's data changed
await tmpService.getMetrics(id);                 // time in state, effort, active, overlap
await tmpService.whoCanActOn(id);                // who has agency here, now
await tmpService.whatCanAdvance(actor);          // which subjects this actor can move (indexed)
```

The product implements the stores over its own schema and the resolvers over its own data.
retold-workflow names none of it.

## Test

```
npm test
```

## License

MIT
