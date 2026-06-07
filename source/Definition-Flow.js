'use strict';

/**
 * Definition <-> flow-graph marshaling for the workflow map.
 *
 * A workflow definition is states and transitions. A pict-section-flow graph is nodes and
 * connections. These two pure functions translate between them so the map view can render a
 * definition as a graph, let a person edit it, and read it back. They touch no DOM and no
 * API, the same way Board-Model.js does, so the translation is testable on its own. The key
 * property is a round trip: flowToDefinition(definitionToFlow(d)) equals d.
 *
 *   definitionToFlow(definition, layout, options) -> { Key, Name, Nodes, Connections }
 *   flowToDefinition(flow, meta)                  -> { Key, Name, States, Transitions }
 *   validateDefinition(definition)                -> null when valid, else an error string
 *
 * A state becomes a node: its Name is the node Title, its Lane drives the title-bar color
 * (one color per lane), and the rest of the state (Key, Lane, Marker, IsInitial, IsTerminal,
 * Category) rides in the node's Data so nothing is lost. A transition becomes a connection
 * from one node's output port to another's input port, with RequiresEntitlement, ActorAddress
 * and the structured Guard in the connection's Data. Reading back, the connection topology is
 * the source of truth for From and To (the graph is the definition), and the other fields come
 * from Data. Node hashes are derived from the state order, so the output is deterministic and
 * a round trip is stable; the state Key is recovered from Data, never from the hash, so a hash
 * is only an internal join key and a state key may contain any characters.
 *
 * @author Steven Velozo <steven@velozo.com>
 * @license MIT
 */

const libFableWorkflow = require('fable-workflow');

// The node type a state renders as. The StateCard registers under this code, and the map view
// adds new state nodes with it; kept here so the marshaling and the card agree on one name.
const STATE_NODE_TYPE = 'WorkflowState';

// Per-node geometry and the lane-column placement used when no saved layout is supplied. Lanes
// become columns and the states within a lane stack down the column, which reads as a workflow.
const NODE_WIDTH = 190;
const NODE_HEIGHT = 70;
const COLUMN_WIDTH = 260;
const ROW_HEIGHT = 120;
const MARGIN_X = 60;
const MARGIN_Y = 60;

// A small fixed palette, assigned to lanes in the order the lanes first appear. ASCII hex only;
// it cycles if a definition has more lanes than colors. These are title-bar fills behind light
// text, so they are mid-to-dark tones.
const LANE_PALETTE =
[
	'#3d6fb4', '#2e8b6f', '#a8632e', '#7a52a8', '#b43d6f',
	'#4f8a3d', '#b48a2e', '#3d8aa8', '#8a4f9a', '#6f6f6f'
];

/** The unique lanes in definition order. A state with no Lane is its own lane (its Key). */
function lanesOf(pDefinition)
{
	let tmpStates = (pDefinition && pDefinition.States) || [];
	let tmpSeen = {};
	let tmpLanes = [];
	tmpStates.forEach((pState) =>
	{
		let tmpLane = pState.Lane || pState.Key;
		if (!tmpSeen[tmpLane]) { tmpSeen[tmpLane] = true; tmpLanes.push(tmpLane); }
	});
	return tmpLanes;
}

/** lane -> color, lanes colored in the order they first appear, cycling the palette. */
function laneColors(pDefinition)
{
	let tmpColors = {};
	lanesOf(pDefinition).forEach((pLane, pIndex) => { tmpColors[pLane] = LANE_PALETTE[pIndex % LANE_PALETTE.length]; });
	return tmpColors;
}

function _nodeHash(pIndex) { return STATE_NODE_TYPE + '-' + pIndex; }
function _inPortHash(pNodeHash) { return pNodeHash + '-in'; }
function _outPortHash(pNodeHash) { return pNodeHash + '-out'; }
function _transitionHash(pIndex) { return 'transition-' + pIndex; }

/**
 * Build a flow graph from a workflow definition. `pLayout` is an optional map of
 * stateKey -> { X, Y } (a saved hand-tuned arrangement); states without an entry fall back to
 * the lane-column placement. The returned object carries the workflow Key and Name alongside
 * Nodes and Connections so flowToDefinition can recover them; setFlowData ignores the extras.
 */
function definitionToFlow(pDefinition, pLayout, pOptions)
{
	let tmpDefinition = pDefinition || {};
	let tmpStates = tmpDefinition.States || [];
	let tmpTransitions = tmpDefinition.Transitions || [];
	let tmpLayout = pLayout || {};
	let tmpOptions = pOptions || {};
	let tmpNodeType = tmpOptions.NodeType || STATE_NODE_TYPE;
	let tmpColors = laneColors(tmpDefinition);
	let tmpLaneOrder = lanesOf(tmpDefinition);
	let tmpLaneColumn = {};
	tmpLaneOrder.forEach((pLane, pIndex) => { tmpLaneColumn[pLane] = pIndex; });
	let tmpRowInLane = {};

	let tmpKeyToNodeHash = {};
	let tmpNodes = tmpStates.map((pState, pIndex) =>
	{
		let tmpHash = _nodeHash(pIndex);
		tmpKeyToNodeHash[pState.Key] = tmpHash;

		let tmpLane = pState.Lane || pState.Key;
		let tmpColumn = (tmpLaneColumn[tmpLane] != null) ? tmpLaneColumn[tmpLane] : 0;
		let tmpRow = tmpRowInLane[tmpLane] || 0;
		tmpRowInLane[tmpLane] = tmpRow + 1;

		let tmpSaved = tmpLayout[pState.Key] || {};
		let tmpX = (typeof tmpSaved.X === 'number') ? tmpSaved.X : (MARGIN_X + tmpColumn * COLUMN_WIDTH);
		let tmpY = (typeof tmpSaved.Y === 'number') ? tmpSaved.Y : (MARGIN_Y + tmpRow * ROW_HEIGHT);

		let tmpData = { Key: pState.Key };
		if (pState.Lane) { tmpData.Lane = pState.Lane; }
		if (pState.Marker) { tmpData.Marker = pState.Marker; }
		if (pState.IsInitial) { tmpData.IsInitial = true; }
		if (pState.IsTerminal) { tmpData.IsTerminal = true; }
		if (pState.Category) { tmpData.Category = pState.Category; }

		return {
			Hash: tmpHash,
			Type: tmpNodeType,
			X: tmpX,
			Y: tmpY,
			Width: (typeof tmpSaved.Width === 'number') ? tmpSaved.Width : NODE_WIDTH,
			Height: (typeof tmpSaved.Height === 'number') ? tmpSaved.Height : NODE_HEIGHT,
			Title: pState.Name || pState.Key,
			TitleBarColor: tmpColors[tmpLane] || LANE_PALETTE[0],
			Ports:
			[
				{ Hash: _inPortHash(tmpHash), Direction: 'input', Side: 'left', Label: 'In' },
				{ Hash: _outPortHash(tmpHash), Direction: 'output', Side: 'right', Label: 'Out' }
			],
			Data: tmpData
		};
	});

	let tmpConnections = tmpTransitions.map((pTransition, pIndex) =>
	{
		let tmpSourceHash = tmpKeyToNodeHash[pTransition.From];
		let tmpTargetHash = tmpKeyToNodeHash[pTransition.To];
		let tmpData = {};
		if (pTransition.Key) { tmpData.Key = pTransition.Key; }
		if (pTransition.RequiresEntitlement) { tmpData.RequiresEntitlement = pTransition.RequiresEntitlement; }
		if (pTransition.ActorAddress) { tmpData.ActorAddress = pTransition.ActorAddress; }
		if (pTransition.Guard != null) { tmpData.Guard = _deepCopy(pTransition.Guard); }

		return {
			Hash: _transitionHash(pIndex),
			SourceNodeHash: tmpSourceHash,
			SourcePortHash: tmpSourceHash ? _outPortHash(tmpSourceHash) : null,
			TargetNodeHash: tmpTargetHash,
			TargetPortHash: tmpTargetHash ? _inPortHash(tmpTargetHash) : null,
			Data: tmpData
		};
	});

	return { Key: tmpDefinition.Key, Name: tmpDefinition.Name, Nodes: tmpNodes, Connections: tmpConnections };
}

/**
 * Read a flow graph back into a workflow definition. From and To come from the connection
 * topology (each endpoint's node mapped back to its state Key), so editing the graph edits the
 * definition; the other transition fields come from the connection Data. A node's state Key
 * comes from its Data (falling back to a slug of its Title, then its hash) so a node a person
 * dragged in from the palette still yields a usable state. `pMeta` (optional { Key, Name })
 * supplies the workflow identity when the flow object does not carry it.
 */
function flowToDefinition(pFlow, pMeta)
{
	let tmpFlow = pFlow || {};
	let tmpNodes = tmpFlow.Nodes || [];
	let tmpConnections = tmpFlow.Connections || [];
	let tmpMeta = pMeta || {};

	let tmpHashToKey = {};
	let tmpUsedKeys = {};
	tmpNodes.forEach((pNode) =>
	{
		let tmpData = pNode.Data || {};
		let tmpKey = tmpData.Key || _slug(pNode.Title) || pNode.Hash;
		// Keep keys unique even if two palette-dropped nodes share a title.
		if (tmpUsedKeys[tmpKey]) { let tmpN = 2; while (tmpUsedKeys[tmpKey + '_' + tmpN]) { tmpN++; } tmpKey = tmpKey + '_' + tmpN; }
		tmpUsedKeys[tmpKey] = true;
		tmpHashToKey[pNode.Hash] = tmpKey;
	});

	let tmpStates = tmpNodes.map((pNode) =>
	{
		let tmpData = pNode.Data || {};
		let tmpState = { Key: tmpHashToKey[pNode.Hash], Name: pNode.Title || tmpHashToKey[pNode.Hash] };
		if (tmpData.Lane) { tmpState.Lane = tmpData.Lane; }
		if (tmpData.Marker) { tmpState.Marker = tmpData.Marker; }
		if (tmpData.IsInitial) { tmpState.IsInitial = true; }
		if (tmpData.IsTerminal) { tmpState.IsTerminal = true; }
		if (tmpData.Category) { tmpState.Category = tmpData.Category; }
		return tmpState;
	});

	let tmpTransitions = [];
	tmpConnections.forEach((pConnection) =>
	{
		let tmpFrom = tmpHashToKey[pConnection.SourceNodeHash];
		let tmpTo = tmpHashToKey[pConnection.TargetNodeHash];
		// A connection that lost an endpoint (a node was removed under it) is not a transition.
		if (tmpFrom == null || tmpTo == null) { return; }
		let tmpData = pConnection.Data || {};
		let tmpTransition = { From: tmpFrom, To: tmpTo };
		if (tmpData.Key) { tmpTransition.Key = tmpData.Key; }
		if (tmpData.RequiresEntitlement) { tmpTransition.RequiresEntitlement = tmpData.RequiresEntitlement; }
		if (tmpData.ActorAddress) { tmpTransition.ActorAddress = tmpData.ActorAddress; }
		if (tmpData.Guard != null) { tmpTransition.Guard = _deepCopy(tmpData.Guard); }
		tmpTransitions.push(tmpTransition);
	});

	return {
		Key: tmpFlow.Key || tmpMeta.Key,
		Name: tmpFlow.Name || tmpMeta.Name,
		States: tmpStates,
		Transitions: tmpTransitions
	};
}

/**
 * Run an assembled definition through the engine's own defineWorkflow checks (a Key is present,
 * at least one state, every transition references a known state, every guard is structurally
 * valid). Returns null when it passes, or the engine's error string, so the map view can refuse
 * to save a broken definition and show why.
 */
function validateDefinition(pDefinition)
{
	try
	{
		let tmpEngine = new libFableWorkflow.WorkflowEngine();
		tmpEngine.defineWorkflow(pDefinition);
		return null;
	}
	catch (pError)
	{
		return (pError && pError.message) || 'invalid workflow definition';
	}
}

function _deepCopy(pValue)
{
	if (pValue === undefined || pValue === null) { return pValue; }
	return JSON.parse(JSON.stringify(pValue));
}

// Turn a display name into a usable state key: lowercase, non-alphanumerics to underscores.
function _slug(pValue)
{
	if (pValue == null) { return ''; }
	return String(pValue).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

module.exports =
{
	definitionToFlow: definitionToFlow,
	flowToDefinition: flowToDefinition,
	validateDefinition: validateDefinition,
	lanesOf: lanesOf,
	laneColors: laneColors,
	STATE_NODE_TYPE: STATE_NODE_TYPE
};
