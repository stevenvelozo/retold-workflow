'use strict';

/**
 * Definition <-> flow-graph marshaling for the workflow map.
 *
 * A workflow definition is states and transitions. The graph makes both first class: a state is a
 * node, and a transition is also a node (a TransitionCard) sitting between two states, wired
 * Status -> transition -> Status. So a transition becomes one transition node plus two edges: an
 * edge from the source state's output to the transition's input, and an edge from the transition's
 * output to the target state's input. Reading the graph back, the transition's From and To come
 * from those two edges (the wires are the truth), and its gate fields (RequiresEntitlement,
 * ActorAddress, Guard) come from the transition node's Data.
 *
 *   definitionToFlow(definition, layout, options) -> { Key, Name, Nodes, Connections }
 *   flowToDefinition(flow, meta)                  -> { Key, Name, States, Transitions }
 *   validateDefinition(definition)                -> null when valid, else an error string
 *
 * These are pure and dependency-light (only the engine, for validation), the same shape as the
 * board model, so the translation is testable on its own. The key property is a round trip:
 * flowToDefinition(definitionToFlow(d)) equals d. Node hashes are derived from order, so the
 * output is deterministic; a node's state Key is recovered from Data (never from the hash), so a
 * hash is only an internal join key.
 *
 * @author Steven Velozo <steven@velozo.com>
 * @license MIT
 */

const libFableWorkflow = require('fable-workflow');

// The two node types. A state renders as a StateCard, a transition as a TransitionCard; both
// register under these codes, and the marshaling and the cards agree on the names here.
const STATE_NODE_TYPE = 'WorkflowState';
const TRANSITION_NODE_TYPE = 'WorkflowTransition';

// Geometry and the lane-column placement used when no saved layout is supplied. Lanes become
// columns and the states within a lane stack down the column; a transition sits at the midpoint
// between the two states it joins.
const NODE_WIDTH = 190;
const NODE_HEIGHT = 70;
const TRANSITION_WIDTH = 160;
const TRANSITION_HEIGHT = 64;
// Corner radius reads as shape: a state is a barely-rounded rectangle, a transition is a very
// rounded capsule. The strong contrast is what tells the two kinds apart at a glance.
const STATE_CORNER_RADIUS = 5;
const TRANSITION_CORNER_RADIUS = 24;
const COLUMN_WIDTH = 300;
const ROW_HEIGHT = 130;
const MARGIN_X = 60;
const MARGIN_Y = 60;

// Transition cards are connectors, not lane members, so they share one muted, theme-driven color
// rather than a lane color, which keeps them distinct from and recessive to the colorful states.
// White title text (the renderer default) reads on this mid-tone in light and dark themes.
const TRANSITION_COLOR = 'var(--theme-color-text-secondary, #7f8c8d)';

// A small fixed palette, assigned to lanes in the order the lanes first appear. ASCII hex only;
// it cycles if a definition has more lanes than colors.
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

function _stateHash(pIndex) { return STATE_NODE_TYPE + '-' + pIndex; }
function _transitionHash(pIndex) { return TRANSITION_NODE_TYPE + '-' + pIndex; }
function _inPortHash(pNodeHash) { return pNodeHash + '-in'; }
function _outPortHash(pNodeHash) { return pNodeHash + '-out'; }

// The display title for a transition card: the gate it enforces, so the flow reads at a glance.
function _transitionTitle(pTransition) { return pTransition.RequiresEntitlement || 'open'; }

// A stable key for a transition (for layout lookup): its own Key, else From->To.
function _transitionKey(pTransition) { return pTransition.Key || (pTransition.From + '->' + pTransition.To); }

/**
 * Build a flow graph from a workflow definition. `pLayout` is an optional map of
 * key -> { X, Y } (a saved arrangement), where a state's key is its state Key and a transition's
 * key is its Key or "From->To". States without an entry fall back to lane-column placement;
 * transitions without one are centered between their two states. The returned object carries the
 * workflow Key and Name alongside Nodes and Connections; setFlowData ignores the extras.
 */
function definitionToFlow(pDefinition, pLayout, pOptions)
{
	let tmpDefinition = pDefinition || {};
	let tmpStates = tmpDefinition.States || [];
	let tmpTransitions = tmpDefinition.Transitions || [];
	let tmpLayout = pLayout || {};
	let tmpOptions = pOptions || {};
	let tmpStateType = tmpOptions.StateNodeType || STATE_NODE_TYPE;
	let tmpTransitionType = tmpOptions.TransitionNodeType || TRANSITION_NODE_TYPE;
	let tmpColors = laneColors(tmpDefinition);
	let tmpLaneOrder = lanesOf(tmpDefinition);
	let tmpLaneColumn = {};
	tmpLaneOrder.forEach((pLane, pIndex) => { tmpLaneColumn[pLane] = pIndex; });
	let tmpRowInLane = {};

	let tmpKeyToStateHash = {};
	let tmpStateCenter = {};
	let tmpStateNodes = tmpStates.map((pState, pIndex) =>
	{
		let tmpHash = _stateHash(pIndex);
		tmpKeyToStateHash[pState.Key] = tmpHash;

		let tmpLane = pState.Lane || pState.Key;
		let tmpColumn = (tmpLaneColumn[tmpLane] != null) ? tmpLaneColumn[tmpLane] : 0;
		let tmpRow = tmpRowInLane[tmpLane] || 0;
		tmpRowInLane[tmpLane] = tmpRow + 1;

		let tmpSaved = tmpLayout[pState.Key] || {};
		let tmpX = (typeof tmpSaved.X === 'number') ? tmpSaved.X : (MARGIN_X + tmpColumn * COLUMN_WIDTH);
		let tmpY = (typeof tmpSaved.Y === 'number') ? tmpSaved.Y : (MARGIN_Y + tmpRow * ROW_HEIGHT);
		let tmpWidth = (typeof tmpSaved.Width === 'number') ? tmpSaved.Width : NODE_WIDTH;
		let tmpHeight = (typeof tmpSaved.Height === 'number') ? tmpSaved.Height : NODE_HEIGHT;
		tmpStateCenter[tmpHash] = { x: tmpX + tmpWidth / 2, y: tmpY + tmpHeight / 2 };

		let tmpData = { Key: pState.Key };
		if (pState.Lane) { tmpData.Lane = pState.Lane; }
		if (pState.Marker) { tmpData.Marker = pState.Marker; }
		if (pState.IsInitial) { tmpData.IsInitial = true; }
		if (pState.IsTerminal) { tmpData.IsTerminal = true; }
		if (pState.Category) { tmpData.Category = pState.Category; }

		return {
			Hash: tmpHash,
			Type: tmpStateType,
			X: tmpX, Y: tmpY, Width: tmpWidth, Height: tmpHeight,
			Title: pState.Name || pState.Key,
			TitleBarColor: tmpColors[tmpLane] || LANE_PALETTE[0],
			// Style.TitleBarColor is an inline style, which the renderer applies over the title-bar
			// CSS rule; the plain TitleBarColor attribute alone would be overridden by that rule.
			Style: { TitleBarColor: tmpColors[tmpLane] || LANE_PALETTE[0] },
			CornerRadius: STATE_CORNER_RADIUS,
			Ports:
			[
				{ Hash: _inPortHash(tmpHash), Direction: 'input', Side: 'left', Label: 'In' },
				{ Hash: _outPortHash(tmpHash), Direction: 'output', Side: 'right', Label: 'Out' }
			],
			Data: tmpData
		};
	});

	let tmpTransitionNodes = [];
	let tmpConnections = [];
	tmpTransitions.forEach((pTransition, pIndex) =>
	{
		let tmpHash = _transitionHash(pIndex);
		let tmpSourceHash = tmpKeyToStateHash[pTransition.From];
		let tmpTargetHash = tmpKeyToStateHash[pTransition.To];

		let tmpData = {};
		if (pTransition.Key) { tmpData.Key = pTransition.Key; }
		if (pTransition.RequiresEntitlement) { tmpData.RequiresEntitlement = pTransition.RequiresEntitlement; }
		if (pTransition.ActorAddress) { tmpData.ActorAddress = pTransition.ActorAddress; }
		if (pTransition.Guard != null) { tmpData.Guard = _deepCopy(pTransition.Guard); }

		// Place the transition card centered between its two states, unless a layout pins it.
		let tmpSaved = tmpLayout[_transitionKey(pTransition)] || {};
		let tmpSourceCenter = tmpStateCenter[tmpSourceHash] || { x: MARGIN_X, y: MARGIN_Y };
		let tmpTargetCenter = tmpStateCenter[tmpTargetHash] || tmpSourceCenter;
		let tmpMidX = (tmpSourceCenter.x + tmpTargetCenter.x) / 2;
		let tmpMidY = (tmpSourceCenter.y + tmpTargetCenter.y) / 2;
		let tmpX = (typeof tmpSaved.X === 'number') ? tmpSaved.X : (tmpMidX - TRANSITION_WIDTH / 2);
		let tmpY = (typeof tmpSaved.Y === 'number') ? tmpSaved.Y : (tmpMidY - TRANSITION_HEIGHT / 2);

		// No per-node TitleBarColor: the TransitionCard type carries a theme-driven color so transition
		// cards recede uniformly against the lane-colored state cards.
		tmpTransitionNodes.push({
			Hash: tmpHash,
			Type: tmpTransitionType,
			X: tmpX, Y: tmpY, Width: TRANSITION_WIDTH, Height: TRANSITION_HEIGHT,
			Title: _transitionTitle(pTransition),
			Style: { TitleBarColor: TRANSITION_COLOR },
			CornerRadius: TRANSITION_CORNER_RADIUS,
			Ports:
			[
				{ Hash: _inPortHash(tmpHash), Direction: 'input', Side: 'left', Label: 'In' },
				{ Hash: _outPortHash(tmpHash), Direction: 'output', Side: 'right', Label: 'Out' }
			],
			Data: tmpData
		});

		if (tmpSourceHash)
		{
			tmpConnections.push({ Hash: 'wfedge-' + pIndex + '-in', SourceNodeHash: tmpSourceHash, SourcePortHash: _outPortHash(tmpSourceHash), TargetNodeHash: tmpHash, TargetPortHash: _inPortHash(tmpHash), Data: {} });
		}
		if (tmpTargetHash)
		{
			tmpConnections.push({ Hash: 'wfedge-' + pIndex + '-out', SourceNodeHash: tmpHash, SourcePortHash: _outPortHash(tmpHash), TargetNodeHash: tmpTargetHash, TargetPortHash: _inPortHash(tmpTargetHash), Data: {} });
		}
	});

	return { Key: tmpDefinition.Key, Name: tmpDefinition.Name, Nodes: tmpStateNodes.concat(tmpTransitionNodes), Connections: tmpConnections };
}

/**
 * Read a flow graph back into a workflow definition. State nodes become states. Each transition
 * node becomes a transition whose From is the state on its incoming edge and whose To is the state
 * on its outgoing edge (the wires are the truth); its gate fields come from the node's Data. A
 * transition node missing either edge is incomplete and dropped. `pMeta` (optional { Key, Name })
 * supplies the workflow identity when the flow object does not carry it.
 */
function flowToDefinition(pFlow, pMeta)
{
	let tmpFlow = pFlow || {};
	let tmpNodes = tmpFlow.Nodes || [];
	let tmpConnections = tmpFlow.Connections || [];
	let tmpMeta = pMeta || {};

	let tmpTransitionNodes = tmpNodes.filter((pNode) => pNode.Type === TRANSITION_NODE_TYPE);
	let tmpStateNodes = tmpNodes.filter((pNode) => pNode.Type !== TRANSITION_NODE_TYPE);

	let tmpHashToKey = {};
	let tmpUsedKeys = {};
	tmpStateNodes.forEach((pNode) =>
	{
		let tmpData = pNode.Data || {};
		let tmpKey = tmpData.Key || _slug(pNode.Title) || pNode.Hash;
		if (tmpUsedKeys[tmpKey]) { let tmpN = 2; while (tmpUsedKeys[tmpKey + '_' + tmpN]) { tmpN++; } tmpKey = tmpKey + '_' + tmpN; }
		tmpUsedKeys[tmpKey] = true;
		tmpHashToKey[pNode.Hash] = tmpKey;
	});

	let tmpStates = tmpStateNodes.map((pNode) =>
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

	// Index edges by the transition node they touch.
	let tmpIncoming = {}; // transitionHash -> source state node hash
	let tmpOutgoing = {}; // transitionHash -> target state node hash
	let tmpIsTransition = {};
	tmpTransitionNodes.forEach((pNode) => { tmpIsTransition[pNode.Hash] = true; });
	tmpConnections.forEach((pConnection) =>
	{
		if (tmpIsTransition[pConnection.TargetNodeHash]) { tmpIncoming[pConnection.TargetNodeHash] = pConnection.SourceNodeHash; }
		if (tmpIsTransition[pConnection.SourceNodeHash]) { tmpOutgoing[pConnection.SourceNodeHash] = pConnection.TargetNodeHash; }
	});

	let tmpTransitions = [];
	tmpTransitionNodes.forEach((pNode) =>
	{
		let tmpFrom = tmpHashToKey[tmpIncoming[pNode.Hash]];
		let tmpTo = tmpHashToKey[tmpOutgoing[pNode.Hash]];
		// A transition card not wired between two states (yet) is not a transition.
		if (tmpFrom == null || tmpTo == null) { return; }
		let tmpData = pNode.Data || {};
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
 * Run an assembled definition through the engine's own defineWorkflow checks (a Key is present, at
 * least one state, every transition references a known state, every guard is structurally valid).
 * Returns null when it passes, or the engine's error string.
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
	transitionTitle: _transitionTitle,
	STATE_NODE_TYPE: STATE_NODE_TYPE,
	TRANSITION_NODE_TYPE: TRANSITION_NODE_TYPE,
	TRANSITION_COLOR: TRANSITION_COLOR
};
