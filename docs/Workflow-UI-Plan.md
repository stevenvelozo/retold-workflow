# Workflow UI Plan (retold-workflow)

## Purpose

retold-workflow ships the engine-facing core: the workflow service, the type catalog, and
the board model. This plans the browser layer on top of it: the views a product mounts to
map out, author, run, and watch workflows.

As with the rest of retold-workflow, the views are not opinionated about the product. They
render from data and call an injected API client, so plansheet points the client at its
`/1.0/Workflow` routes and a different product points it at its own and gets the same UI.

There are two complementary pictures of a workflow, and we want both:

- The **map** (design time): a node-and-edge diagram of a workflow definition. States are
  nodes, transitions are edges, lanes are color, guards and gates are properties. This is
  where a person designs or reads how work is meant to move. Built on pict-section-flow.
- The **board** (run time): the lanes a person works in day to day, with each card (a
  subject) sitting in the lane of its current state. Built on the board model already in
  the core.

Plus the per-subject detail (timeline, metrics, agency) and the type catalog (built-ins,
adopt, drift).

## The pieces

### 1. The workflow map, the centerpiece (pict-section-flow)

pict-section-flow is a node-graph editor: typed input/output ports, bezier or orthogonal
connections, custom card types, on-graph property panels, auto-layout, layout persistence,
and a large event surface. It is a workflow designer waiting to happen.

The mapping from a workflow definition to a flow graph:

- A **state** becomes a node. A `StateCard` (a `PictFlowCard` subclass) carries the state
  Key as its Code, the Name as its title, the Lane as its color (one title-bar color per
  lane), an input port for incoming transitions and an output port for outgoing ones, and a
  Form properties panel to edit Name, Lane, Marker, IsInitial, and IsTerminal.
- A **transition** becomes a connection from one state's output port to another's input
  port. Its properties (RequiresEntitlement, ActorAddress, the structured Guard) edit
  through a panel on the connection.
- The whole graph is the workflow definition. Two pure functions marshal between them:
  `definitionToFlow(definition, layout)` builds the nodes and connections (placing nodes
  from a saved layout, or from autoLayout when there is none), and `flowToDefinition(flow)`
  reads the nodes and connections back into states and transitions. These are pure and
  testable, the same shape as the board model.
- **Layout**: `autoLayout` gives a sane first arrangement (topological); `saveLayout` and
  `restoreLayout` persist node positions so a hand-tuned map stays put. The layout is per
  type and stored through the API client (a layout blob on the VisionType, or a dedicated
  layout route), not in the definition. Positions are not semantics.
- **Validation before save**: run the assembled definition through the engine's own checks
  (the same ones `defineWorkflow` applies) and surface any error (a transition to an unknown
  state, an invalid guard) on the offending node or edge before persisting.
- **Built-ins are read-only**: opening a platform built-in shows the map read-only; the
  first edit offers to adopt it (clone into the tenant) and then edits the clone. This is the
  catalog's adopt path, surfaced at the moment of editing.

The guard editor deserves a note. A guard is a structured tree (all / any / not, plus a leaf
of `{ address, op, value }`). The first version edits it as a Form: pick all / any / not, add
leaves with an address, an operator from the known set, and a value. A richer visual tree
editor can come later; the data shape does not change.

### 2. The board, run time (board model)

The board model (already in the core) groups subjects into lanes honoring the many-to-one
rule. The board view renders its output: one column per lane, cards in the lane of their
current state, each card badged with its state marker, so a move within a lane re-badges a
card without moving it and a move across lanes slides it. Advancing is a card action (a menu
of the available exits, or a drag to a lane) that calls `advance` and, on a blocked move,
surfaces the gate reason through pict-section-modal, never a native alert. The board reads
the subjects and their states for a type from the API; that read is a product endpoint we add
when we wire plansheet.

### 3. Subject detail: timeline, metrics, agency

For a single subject (a WorkItem):

- **Timeline**: the event log as a vertical history (opened, entered and left states, actor
  start and stop, became-available, closed), each row with its actor and time.
- **Metrics**: the folded rollup as small bars or figures (time in each state, active,
  stalled, effort, overlap).
- **Agency**: who can act now (the open exits and their required entitlement), and for the
  current user, which moves they personally can make.

### 4. The type catalog and picker

The union list from the catalog: built-ins (labeled) plus the tenant's own types, with adopt
for a built-in and a drift indicator when a clone's source has advanced. This is also the
entry point to the map: open a type to read or edit its workflow.

## Architecture

- The views live in retold-workflow (`source/views/`) and depend on pict, pict-view,
  pict-section-flow, and pict-section-form. The pure cores (the board model, the
  definition/flow marshaling) stay dependency-free in `source/`.
- Every view takes an **injected API client**. The interface is small:
  - `getTypes()`, `adoptType(builtInID)`, `getType(id)`, `saveType(id, definition)`,
    `getLayout(id)` / `saveLayout(id, layout)`
  - `getBoard(typeID)` returning subjects with their current state
  - `getSubject(id)`, `advance(id, toState)`, `reevaluate(id)`, `getTimeline(id)`,
    `getMetrics(id)`, `getAgency(id)`
- retold-workflow ships a **reference client**: a thin fetch wrapper with a configurable base
  path and auth header that hits the standard routes. plansheet's `/1.0/Workflow` routes
  already match most of it; the board read and the layout routes are the two to add to
  plansheet during wiring.

## Pure cores to build first (no browser)

Testable now, the same way the board model is:

- `definitionToFlow` / `flowToDefinition` (the map marshaling). The key test is a round trip:
  a definition becomes a flow and comes back to an identical definition.
- A small metrics formatter (raw milliseconds to readable figures) if the metrics view wants
  one.

## Build order

1. The map marshaling (`definitionToFlow` / `flowToDefinition`) plus a round-trip test. Pure.
2. The `StateCard` and the map view: render a definition as a read-only graph first
   (visualize), then make it editable (author), then wire save through the client with
   validation.
3. The board view over the board model, with advance and the gate-reason modal.
4. Subject detail (timeline, metrics, agency).
5. The catalog and picker, with adopt and drift.
6. plansheet wiring: the reference client against `/1.0/Workflow`, the two new endpoints
   (board read, layout), a route and a section, and browser verification through the preview
   tooling.
7. retold-workflow 0.2.0 publish (the views, the cards, the marshaling, the board model),
   then plansheet pins it.

## Open decisions

- **Lanes on the map**: color only, or color plus vertical bands (swim lanes). Color is
  simplest and pict-section-flow is free-form; bands are a later enhancement.
- **Layout storage**: a per-type layout blob through the API (shared across the team) versus
  localStorage (per person). The API blob is the better default for a shared design.
- **Guard editor depth**: the Form builder first, a visual tree later. The guard data shape
  is fixed either way.
- **Editing a built-in**: adopt-on-first-edit (clone then edit) versus an explicit adopt
  button before the map opens editable. Adopt-on-first-edit is smoother; the explicit button
  is clearer. Probably offer both.

## Notes

- pict rules apply: no native confirm / alert / prompt (use pict-section-modal), no
  addEventListener (inline handlers in templates), iterate with `{~TS:~}`, icons from the
  registry, state in AppData. See `modules/pict/CLAUDE.md`.
- Writing and UI copy follow the plain style: ordinary words, ASCII punctuation, no
  buzzwords.
