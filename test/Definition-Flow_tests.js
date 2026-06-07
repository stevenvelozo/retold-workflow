'use strict';

/**
 * retold-workflow - Definition-Flow tests
 *
 * The point is the round trip: a workflow definition becomes a flow graph and reads back to an
 * identical definition. In this graph a transition is its own node (Status -> transition -> Status)
 * with an incoming edge from its source state and an outgoing edge to its target, so the tests
 * check that a transition marshals to a node plus two edges and reads back from those edges.
 */

const libAssert = require('node:assert');
const libDefinitionFlow = require('../source/Definition-Flow.js');

const STATE = libDefinitionFlow.STATE_NODE_TYPE;
const TRANSITION = libDefinitionFlow.TRANSITION_NODE_TYPE;

// A definition that exercises every field the marshaling carries: lanes, markers, an initial and a
// terminal state, a category, and transitions with an entitlement, an actor address, and a guard.
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

function statesOf(pFlow) { return pFlow.Nodes.filter((pNode) => pNode.Type === STATE); }
function transitionsOf(pFlow) { return pFlow.Nodes.filter((pNode) => pNode.Type === TRANSITION); }
function stateByKey(pFlow) { let tmpMap = {}; statesOf(pFlow).forEach((pNode) => { tmpMap[pNode.Data.Key] = pNode; }); return tmpMap; }

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
			libAssert.strictEqual(statesOf(tmpFlow).length, 7);
			let tmpNode = statesOf(tmpFlow)[0];
			libAssert.strictEqual(tmpNode.Title, 'Backlog');
			libAssert.strictEqual(tmpNode.Type, STATE);
			libAssert.strictEqual(tmpNode.Data.Key, 'backlog');
			libAssert.strictEqual(tmpNode.Data.IsInitial, true);
			libAssert.ok(/^#/.test(tmpNode.TitleBarColor), 'has a hex title-bar color');
			libAssert.strictEqual(tmpNode.Ports.length, 2);
		});

		test('states sharing a lane share a title-bar color; different lanes differ', () =>
		{
			let tmpByKey = stateByKey(libDefinitionFlow.definitionToFlow(SOFTWARE));
			libAssert.strictEqual(tmpByKey['in_progress'].TitleBarColor, tmpByKey['in_ci'].TitleBarColor, 'same lane -> same color');
			libAssert.notStrictEqual(tmpByKey['backlog'].TitleBarColor, tmpByKey['done'].TitleBarColor, 'different lanes -> different color');
		});

		test('a transition becomes a transition node plus an in-edge and an out-edge', () =>
		{
			let tmpFlow = libDefinitionFlow.definitionToFlow(SOFTWARE);
			let tmpTransitions = transitionsOf(tmpFlow);
			libAssert.strictEqual(tmpTransitions.length, 6, 'one node per transition');
			libAssert.strictEqual(tmpFlow.Connections.length, 12, 'two edges per transition');

			let tmpByKey = stateByKey(tmpFlow);
			let tmpFirst = tmpTransitions[0]; // backlog -> todo, content.edit
			libAssert.strictEqual(tmpFirst.Title, 'content.edit', 'the gate is the card title');
			libAssert.strictEqual(tmpFirst.Data.RequiresEntitlement, 'content.edit');
			libAssert.notStrictEqual(tmpFirst.TitleBarColor, tmpByKey['backlog'].TitleBarColor, 'transition cards read differently from states');

			let tmpInEdge = tmpFlow.Connections.find((pConn) => pConn.TargetNodeHash === tmpFirst.Hash);
			let tmpOutEdge = tmpFlow.Connections.find((pConn) => pConn.SourceNodeHash === tmpFirst.Hash);
			libAssert.strictEqual(tmpInEdge.SourceNodeHash, tmpByKey['backlog'].Hash, 'in-edge comes from the source state');
			libAssert.strictEqual(tmpInEdge.SourcePortHash, tmpByKey['backlog'].Ports[1].Hash);
			libAssert.strictEqual(tmpOutEdge.TargetNodeHash, tmpByKey['todo'].Hash, 'out-edge goes to the target state');
			libAssert.strictEqual(tmpOutEdge.TargetPortHash, tmpByKey['todo'].Ports[0].Hash);
		});

		test('a transition with no entitlement titles as "open"', () =>
		{
			let tmpFlow = libDefinitionFlow.definitionToFlow({ Key: 'k', Name: 'K', States: [ { Key: 'a' }, { Key: 'b' } ], Transitions: [ { From: 'a', To: 'b' } ] });
			libAssert.strictEqual(transitionsOf(tmpFlow)[0].Title, 'open');
		});

		test('a saved layout places a state; absent keys fall back to lane columns', () =>
		{
			let tmpFlow = libDefinitionFlow.definitionToFlow(SOFTWARE, { todo: { X: 999, Y: 888 } });
			let tmpByKey = stateByKey(tmpFlow);
			libAssert.strictEqual(tmpByKey['todo'].X, 999);
			libAssert.strictEqual(tmpByKey['todo'].Y, 888);
			libAssert.strictEqual(typeof tmpByKey['backlog'].X, 'number');
		});
	});

	suite('flowToDefinition', () =>
	{
		test('From and To come from the transition node edges, not stale data', () =>
		{
			let tmpFlow = libDefinitionFlow.definitionToFlow(SOFTWARE);
			let tmpByKey = stateByKey(tmpFlow);
			let tmpFirst = transitionsOf(tmpFlow)[0]; // backlog -> todo
			// Re-point its out-edge from todo to done; reading back must follow the wire.
			let tmpOutEdge = tmpFlow.Connections.find((pConn) => pConn.SourceNodeHash === tmpFirst.Hash);
			tmpOutEdge.TargetNodeHash = tmpByKey['done'].Hash;
			tmpOutEdge.TargetPortHash = tmpByKey['done'].Ports[0].Hash;
			let tmpBack = libDefinitionFlow.flowToDefinition(tmpFlow);
			libAssert.strictEqual(tmpBack.Transitions[0].From, 'backlog');
			libAssert.strictEqual(tmpBack.Transitions[0].To, 'done');
		});

		test('a transition node missing an edge is dropped', () =>
		{
			let tmpFlow = libDefinitionFlow.definitionToFlow(SOFTWARE);
			let tmpFirst = transitionsOf(tmpFlow)[0];
			tmpFlow.Connections = tmpFlow.Connections.filter((pConn) => pConn.SourceNodeHash !== tmpFirst.Hash);
			let tmpBack = libDefinitionFlow.flowToDefinition(tmpFlow);
			libAssert.strictEqual(tmpBack.Transitions.length, 5);
		});

		test('a palette-dropped state node with no Data.Key gets a key slugged from its title', () =>
		{
			let tmpFlow = libDefinitionFlow.definitionToFlow(SOFTWARE);
			tmpFlow.Nodes.push({ Hash: 'node-new', Type: STATE, Title: 'On Hold', Ports: [], Data: {} });
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
