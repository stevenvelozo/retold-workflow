'use strict';

/**
 * retold-workflow - Definition-Flow tests
 *
 * The point is the round trip: a workflow definition becomes a flow graph and reads back to an
 * identical definition. Around that, the marshaling carries lanes to colors, transitions to
 * connections between the right ports, and the engine's own checks gate a save.
 */

const libAssert = require('node:assert');
const libDefinitionFlow = require('../source/Definition-Flow.js');

// A definition that exercises every field the marshaling carries: lanes, markers, an initial and
// a terminal state, a category, and transitions with an entitlement, an actor address, and a
// structured guard. Two states share the In Progress lane (the many-to-one rule).
const SOFTWARE =
{
	Key: 'software',
	Name: 'Software',
	States:
	[
		{ Key: 'backlog',     Name: 'Backlog',    Lane: 'Backlog',     IsInitial: true },
		{ Key: 'todo',        Name: 'Ready',      Lane: 'Todo',        Marker: 'ready' },
		{ Key: 'in_progress', Name: 'Coding',     Lane: 'In Progress', Marker: 'coding' },
		{ Key: 'in_ci',       Name: 'CI Running', Lane: 'In Progress', Marker: 'CI running', Category: 'automated' },
		{ Key: 'in_review',   Name: 'In Review',  Lane: 'Review',      Marker: 'awaiting review' },
		{ Key: 'approved',    Name: 'Approved',   Lane: 'Review',      Marker: 'approved' },
		{ Key: 'done',        Name: 'Done',       Lane: 'Done',        IsTerminal: true }
	],
	Transitions:
	[
		{ From: 'backlog',     To: 'todo',        RequiresEntitlement: 'content.edit' },
		{ From: 'todo',        To: 'in_progress', RequiresEntitlement: 'content.edit' },
		{ From: 'in_progress', To: 'in_ci',       RequiresEntitlement: 'content.edit', Guard: { all: [ { address: 'WorkItem.HasBranch', op: 'truthy' } ] } },
		{ From: 'in_ci',       To: 'in_review',   RequiresEntitlement: 'content.edit', ActorAddress: 'WorkItem.IDAssignedUser' },
		{ From: 'in_review',   To: 'approved',    RequiresEntitlement: 'content.approve' },
		{ From: 'approved',    To: 'done',        RequiresEntitlement: 'content.approve' }
	]
};

suite('retold-workflow: Definition-Flow', () =>
{
	suite('the round trip', () =>
	{
		test('flowToDefinition(definitionToFlow(d)) equals d', () =>
		{
			let tmpFlow = libDefinitionFlow.definitionToFlow(SOFTWARE);
			let tmpBack = libDefinitionFlow.flowToDefinition(tmpFlow);
			libAssert.deepStrictEqual(tmpBack, SOFTWARE);
		});

		test('the source definition is not mutated', () =>
		{
			let tmpCopy = JSON.parse(JSON.stringify(SOFTWARE));
			libDefinitionFlow.definitionToFlow(SOFTWARE);
			libAssert.deepStrictEqual(SOFTWARE, tmpCopy);
		});

		test('the guard rides through as a deep copy, not a shared reference', () =>
		{
			let tmpFlow = libDefinitionFlow.definitionToFlow(SOFTWARE);
			let tmpBack = libDefinitionFlow.flowToDefinition(tmpFlow);
			let tmpSourceGuard = SOFTWARE.Transitions[2].Guard;
			let tmpBackGuard = tmpBack.Transitions[2].Guard;
			libAssert.deepStrictEqual(tmpBackGuard, tmpSourceGuard);
			libAssert.notStrictEqual(tmpBackGuard, tmpSourceGuard);
		});
	});

	suite('definitionToFlow', () =>
	{
		test('a state becomes a node carrying its key, lane color, ports, and data', () =>
		{
			let tmpFlow = libDefinitionFlow.definitionToFlow(SOFTWARE);
			libAssert.strictEqual(tmpFlow.Nodes.length, 7);
			let tmpNode = tmpFlow.Nodes[0];
			libAssert.strictEqual(tmpNode.Title, 'Backlog');
			libAssert.strictEqual(tmpNode.Type, libDefinitionFlow.STATE_NODE_TYPE);
			libAssert.strictEqual(tmpNode.Data.Key, 'backlog');
			libAssert.strictEqual(tmpNode.Data.IsInitial, true);
			libAssert.ok(/^#/.test(tmpNode.TitleBarColor), 'has a hex title-bar color');
			libAssert.strictEqual(tmpNode.Ports.length, 2);
			libAssert.strictEqual(tmpNode.Ports[0].Direction, 'input');
			libAssert.strictEqual(tmpNode.Ports[1].Direction, 'output');
		});

		test('states sharing a lane share a title-bar color; different lanes differ', () =>
		{
			let tmpFlow = libDefinitionFlow.definitionToFlow(SOFTWARE);
			let tmpByKey = {};
			tmpFlow.Nodes.forEach((pNode) => { tmpByKey[pNode.Data.Key] = pNode; });
			libAssert.strictEqual(tmpByKey['in_progress'].TitleBarColor, tmpByKey['in_ci'].TitleBarColor, 'same lane -> same color');
			libAssert.notStrictEqual(tmpByKey['backlog'].TitleBarColor, tmpByKey['done'].TitleBarColor, 'different lanes -> different color');
		});

		test('a transition becomes a connection from the source out-port to the target in-port', () =>
		{
			let tmpFlow = libDefinitionFlow.definitionToFlow(SOFTWARE);
			libAssert.strictEqual(tmpFlow.Connections.length, 6);
			let tmpByKey = {};
			tmpFlow.Nodes.forEach((pNode) => { tmpByKey[pNode.Data.Key] = pNode; });
			let tmpFirst = tmpFlow.Connections[0];
			libAssert.strictEqual(tmpFirst.SourceNodeHash, tmpByKey['backlog'].Hash);
			libAssert.strictEqual(tmpFirst.SourcePortHash, tmpByKey['backlog'].Ports[1].Hash);
			libAssert.strictEqual(tmpFirst.TargetNodeHash, tmpByKey['todo'].Hash);
			libAssert.strictEqual(tmpFirst.TargetPortHash, tmpByKey['todo'].Ports[0].Hash);
			libAssert.strictEqual(tmpFirst.Data.RequiresEntitlement, 'content.edit');
		});

		test('a saved layout places the node; absent keys fall back to lane columns', () =>
		{
			let tmpLayout = { todo: { X: 999, Y: 888 } };
			let tmpFlow = libDefinitionFlow.definitionToFlow(SOFTWARE, tmpLayout);
			let tmpByKey = {};
			tmpFlow.Nodes.forEach((pNode) => { tmpByKey[pNode.Data.Key] = pNode; });
			libAssert.strictEqual(tmpByKey['todo'].X, 999);
			libAssert.strictEqual(tmpByKey['todo'].Y, 888);
			libAssert.strictEqual(typeof tmpByKey['backlog'].X, 'number');
		});
	});

	suite('flowToDefinition', () =>
	{
		test('From and To come from the connection topology, not stale Data', () =>
		{
			let tmpFlow = libDefinitionFlow.definitionToFlow(SOFTWARE);
			// Re-point the first connection's target from "todo" to "done" by hash. Reading back
			// must follow the wire, yielding backlog -> done.
			let tmpByKey = {};
			tmpFlow.Nodes.forEach((pNode) => { tmpByKey[pNode.Data.Key] = pNode; });
			tmpFlow.Connections[0].TargetNodeHash = tmpByKey['done'].Hash;
			tmpFlow.Connections[0].TargetPortHash = tmpByKey['done'].Ports[0].Hash;
			let tmpBack = libDefinitionFlow.flowToDefinition(tmpFlow);
			libAssert.strictEqual(tmpBack.Transitions[0].From, 'backlog');
			libAssert.strictEqual(tmpBack.Transitions[0].To, 'done');
		});

		test('a connection with a removed endpoint is dropped', () =>
		{
			let tmpFlow = libDefinitionFlow.definitionToFlow(SOFTWARE);
			tmpFlow.Connections[0].TargetNodeHash = 'no-such-node';
			let tmpBack = libDefinitionFlow.flowToDefinition(tmpFlow);
			libAssert.strictEqual(tmpBack.Transitions.length, 5);
		});

		test('a palette-dropped node with no Data.Key gets a key slugged from its title', () =>
		{
			let tmpFlow = libDefinitionFlow.definitionToFlow(SOFTWARE);
			tmpFlow.Nodes.push({ Hash: 'node-new', Type: libDefinitionFlow.STATE_NODE_TYPE, Title: 'On Hold', Ports: [], Data: {} });
			let tmpBack = libDefinitionFlow.flowToDefinition(tmpFlow);
			let tmpNewState = tmpBack.States.find((pState) => pState.Name === 'On Hold');
			libAssert.ok(tmpNewState, 'the new state is present');
			libAssert.strictEqual(tmpNewState.Key, 'on_hold');
		});

		test('meta supplies Key and Name when the flow object lacks them', () =>
		{
			let tmpFlow = libDefinitionFlow.definitionToFlow(SOFTWARE);
			delete tmpFlow.Key;
			delete tmpFlow.Name;
			let tmpBack = libDefinitionFlow.flowToDefinition(tmpFlow, { Key: 'software', Name: 'Software' });
			libAssert.strictEqual(tmpBack.Key, 'software');
			libAssert.strictEqual(tmpBack.Name, 'Software');
		});
	});

	suite('validateDefinition', () =>
	{
		test('a sound definition passes (null)', () =>
		{
			libAssert.strictEqual(libDefinitionFlow.validateDefinition(SOFTWARE), null);
		});

		test('a definition assembled from a flow passes the engine checks', () =>
		{
			let tmpBack = libDefinitionFlow.flowToDefinition(libDefinitionFlow.definitionToFlow(SOFTWARE));
			libAssert.strictEqual(libDefinitionFlow.validateDefinition(tmpBack), null);
		});

		test('a transition to an unknown state is rejected with a reason', () =>
		{
			let tmpBroken = JSON.parse(JSON.stringify(SOFTWARE));
			tmpBroken.Transitions.push({ From: 'backlog', To: 'nowhere' });
			let tmpError = libDefinitionFlow.validateDefinition(tmpBroken);
			libAssert.ok(tmpError && /nowhere/.test(tmpError), 'error names the unknown state');
		});

		test('a missing Key is rejected', () =>
		{
			let tmpBroken = JSON.parse(JSON.stringify(SOFTWARE));
			delete tmpBroken.Key;
			libAssert.ok(libDefinitionFlow.validateDefinition(tmpBroken), 'returns an error string');
		});

		test('an invalid guard operator is rejected', () =>
		{
			let tmpBroken = JSON.parse(JSON.stringify(SOFTWARE));
			tmpBroken.Transitions[0].Guard = { address: 'WorkItem.X', op: 'no-such-op' };
			let tmpError = libDefinitionFlow.validateDefinition(tmpBroken);
			libAssert.ok(tmpError && /guard/.test(tmpError), 'error mentions the guard');
		});
	});

	suite('lanesOf / laneColors', () =>
	{
		test('lanesOf returns unique lanes in definition order', () =>
		{
			libAssert.deepStrictEqual(libDefinitionFlow.lanesOf(SOFTWARE), ['Backlog', 'Todo', 'In Progress', 'Review', 'Done']);
		});

		test('laneColors assigns one color per lane', () =>
		{
			let tmpColors = libDefinitionFlow.laneColors(SOFTWARE);
			libAssert.strictEqual(Object.keys(tmpColors).length, 5);
			libAssert.ok(/^#/.test(tmpColors['Backlog']));
		});
	});
});
