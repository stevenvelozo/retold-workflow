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

The type catalog, the workflow service, and the UI are all in (0.2.0): a map/designer on
pict-section-flow, a board, subject detail (timeline, metrics, agency), and a catalog picker,
plus a reference API client the views render against.

## Two entry points

The package keeps the server clean. The main entry (`require('retold-workflow')`) is node-safe:
the workflow service, the type catalog, the board model, the definition/flow marshaling, the
metrics formatter, and the fetch client. None of it pulls in pict, so a product's server uses it
without dragging in the browser layer. The Pict views and the StateCard live behind a second
entry (`require('retold-workflow/source/Retold-Workflow-Views.js')`), which depends on
pict-section-flow; a product's client bundle requires that one.

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

## The UI

Four Pict views render workflows from data and call an injected API client. They name no
product entity; point the client at a product's routes and the same views work anywhere.

- **Map / designer** (`WorkflowMapView`) on pict-section-flow: both states and transitions are
  cards. A state is a `StateCard` colored by lane; a transition is a `TransitionCard` between two
  states, wired Status -> transition -> Status, styled as a muted connector titled with the gate it
  enforces. Editing is on the graph (double-click a card): a state's Name, Lane, Marker, IsInitial,
  IsTerminal; a transition's RequiresEntitlement, ActorAddress, and Guard. The graph is the
  definition: it reads back with each transition's From and To taken from the edges around its card.
  A built-in opens read-only and offers to adopt before editing. Before a save, the assembled
  definition runs through the engine's own `defineWorkflow` checks; a failure is shown, not
  persisted.
- **Board** (`WorkflowBoardView`) over the board model: one column per lane, each subject in the
  lane of its current state, many-to-one so two states share a lane and a move within it only
  re-badges the card. Advancing calls the client; a blocked move shows the reason in a modal.
- **Subject detail** (`WorkflowSubjectView`): the event log as a timeline, the folded metrics as
  figures and per-state bars, and who can act now.
- **Catalog / picker** (`WorkflowCatalogView`): built-ins (labeled) plus the tenant's own types,
  with adopt and a drift note when a clone's source built-in has advanced. The entry point to the
  rest.

The pure cores behind them are testable on their own: `DefinitionFlow.definitionToFlow` /
`flowToDefinition` (with `validateDefinition`), `BoardModel.buildBoardModel`, and
`MetricsFormat.summarizeMetrics`.

### The API client

`WorkflowClient` is a thin fetch wrapper a product hands to the views (or copies). It hits the
standard routes under a configurable base path with a configurable auth header:

```javascript
const { WorkflowClient } = require('retold-workflow');

let tmpClient = new WorkflowClient({ BasePath: '/1.0/Workflow', Credentials: 'same-origin' });
// getTypes / getType / adoptType / saveType / getBoard / getLayout / saveLayout
// open / advance / reevaluate / getSubject / getTimeline / getMetrics / getAgency
```

Each view takes the client as `options.Client` (an object) or finds it by provider name
(`options.ClientProvider`, default `'WorkflowAPI'`). A product whose routes match (plansheet's
`/1.0/Workflow` do) passes one of these and is done.

## Test

`npm test` covers the pure cores: the board model, the definition/flow round trip, the metrics
formatter, the client (against a fake fetch), the type catalog, and the service. The views are
verified in a host app (plansheet) through the browser.

```
npm test
```

## License

MIT
