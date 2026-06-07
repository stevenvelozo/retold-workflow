'use strict';

/**
 * Workflow map / designer.
 *
 * The centerpiece: a workflow definition rendered as a graph where both states and transitions are
 * cards. A state is a StateCard (colored by lane); a transition is a TransitionCard sitting between
 * two states, wired Status -> transition -> Status, styled as a muted connector with the gate it
 * enforces as its title. Editing happens on the graph: double-click a state for its panel (Name,
 * Lane, Marker, IsInitial, IsTerminal); double-click a transition for its panel (RequiresEntitlement,
 * ActorAddress, Guard). Both are ordinary node panels. The graph is the definition: reading it back
 * (flowToDefinition) takes each transition's From and To from the edges around its card.
 *
 * Built-in (platform) types open read-only; the first move to edit one offers to adopt it (clone
 * into the tenant) and edits the clone. Before a save, the assembled definition runs through the
 * engine's own defineWorkflow checks, and a failure is shown rather than persisted. State positions
 * save and restore as a per-type layout through the client; transition cards center themselves
 * between their states. Everything talks to an injected client (the WorkflowClient shape), supplied
 * as options.Client or named by options.ClientProvider (default 'WorkflowAPI').
 *
 * @author Steven Velozo <steven@velozo.com>
 * @license MIT
 */

const libPictView = require('pict-view');
const libPictSectionFlow = require('pict-section-flow');
const libDefinitionFlow = require('../Definition-Flow.js');
const libStateCard = require('../cards/State-Card.js');
const libTransitionCard = require('../cards/Transition-Card.js');

// Title-bar glyphs for the two kinds, registered on the flow's icon provider. They stroke with the
// theme's panel color so they match the white title text on the colored title bars and follow the
// theme. The {FlowIconSize} placeholder is the flow icon provider's size token. A State reads as a
// box with a center point; a Transition as a forward arrow (a move).
const _STATE_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="{FlowIconSize}" height="{FlowIconSize}" viewBox="0 0 24 24" fill="none" stroke="var(--theme-color-background-panel, #ffffff)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="12" cy="12" r="1.6" fill="var(--theme-color-background-panel, #ffffff)" stroke="none"/></svg>';
const _TRANSITION_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="{FlowIconSize}" height="{FlowIconSize}" viewBox="0 0 24 24" fill="none" stroke="var(--theme-color-background-panel, #ffffff)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h12.5"/><path d="M12 5.5l7 6.5-7 6.5"/></svg>';

// The arrange menu. 'workflow' is the bespoke, workflow-aware stairstep (states from the initial
// one, alternating two rows, each state's transitions to its right); the rest dispatch to
// pict-section-flow's own layout algorithms by name so the same graph can be tried a few ways.
const _LAYOUT_CHOICES =
[
	{ Value: 'workflow',  Label: 'Workflow stairstep', Algorithm: null },
	{ Value: 'Staggered', Label: 'Stairstep (compact)', Algorithm: 'Staggered' },
	{ Value: 'Layered',   Label: 'Layered rows',        Algorithm: 'Layered' },
	{ Value: 'Grid',      Label: 'Grid',                Algorithm: 'Grid' },
	{ Value: 'Circular',  Label: 'Circular',            Algorithm: 'Circular' }
];

const _ViewConfiguration =
{
	ViewIdentifier: 'Workflow-Map',
	DefaultRenderable: 'Workflow-Map-Container',
	DefaultDestinationAddress: '#Workflow-Map-Container',
	AutoRender: false,

	ClientProvider: 'WorkflowAPI',
	Client: null,

	CSS: /*css*/`
		.wfmap { display: flex; flex-direction: column; flex: 1; min-height: 0; height: 100%; }
		.wfmap-head { flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 0.75em; padding: 0.5em 0.25em 0.75em; border-bottom: 1px solid var(--theme-color-border-light, #e3e3e3); }
		.wfmap-title { font-size: 1.3em; font-weight: 600; margin: 0; }
		.wfmap-title small { font-weight: 400; color: var(--theme-color-text-secondary, #777); margin-left: 0.5em; font-size: 0.7em; }
		.wfmap-toolbar { display: flex; align-items: center; gap: 0.4em; flex-wrap: wrap; }
		.wfmap-btn { padding: 0.4em 0.75em; border: 1px solid var(--theme-color-border-default, #ccc); border-radius: 5px; background: var(--theme-color-background-panel, #fff); color: var(--theme-color-text-primary, #222); cursor: pointer; font-size: 0.9em; }
		.wfmap-btn:hover { background: var(--theme-color-background-hover, #f2f2f2); }
		.wfmap-btn-primary { background: var(--theme-color-brand-primary, #2e7d74); border-color: var(--theme-color-brand-primary, #2e7d74); color: #fff; }
		.wfmap-btn-primary:hover { filter: brightness(1.05); }
		.wfmap-readonly-note { font-size: 0.82em; color: var(--theme-color-text-secondary, #888); }
		.wfmap-hint { font-size: 0.82em; color: var(--theme-color-text-secondary, #888); margin-left: 0.5em; }
		.wfmap-arrange { display: inline-flex; align-items: center; gap: 0.4em; }
		.wfmap-arrange-label { font-size: 0.82em; color: var(--theme-color-text-secondary, #888); }
		.wfmap-select { padding: 0.4em 0.6em; border: 1px solid var(--theme-color-border-default, #ccc); border-radius: 5px; background: var(--theme-color-background-panel, #fff); color: var(--theme-color-text-primary, #222); cursor: pointer; font-size: 0.9em; }
		.wfmap-select:hover { background: var(--theme-color-background-hover, #f2f2f2); }
		.wfmap-flow { flex: 1; min-height: 520px; border: 1px solid var(--theme-color-border-light, #e3e3e3); border-radius: 6px; overflow: hidden; }
		.wfmap-banner { flex-shrink: 0; }
		.wfmap-errors { margin: 0.5em 0 0; padding: 0.5em 0.75em; border-radius: 5px; background: var(--theme-color-status-error-background, #fdecea); border: 1px solid var(--theme-color-status-error, #e74c3c); color: var(--theme-color-status-error, #c0392b); font-size: 0.85em; }
		.wfmap-errors ul { margin: 0.3em 0 0; padding-left: 1.2em; }
		.wfmap-status { margin: 0.5em 0 0; font-size: 0.85em; color: var(--theme-color-text-secondary, #666); }

		/* On-graph panel body content (rendered inside the flow's panel chrome). */
		.wfp { display: flex; flex-direction: column; gap: 0.45em; font-size: 0.85em; }
		.wfp-field { display: flex; flex-direction: column; gap: 0.15em; }
		.wfp-label { font-size: 0.72em; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; color: var(--theme-color-text-secondary, #666); }
		.wfp-input { width: 100%; box-sizing: border-box; padding: 0.35em; border: 1px solid var(--theme-color-border-default, #ccc); border-radius: 4px; font-size: 0.85em; font-family: inherit; }
		.wfp-textarea { min-height: 70px; resize: vertical; font-family: monospace; font-size: 0.78em; }
		.wfp-check { display: flex; align-items: center; gap: 0.4em; font-size: 0.85em; }
		.wfp-check input { margin: 0; }
		.wfp-transition-head { font-weight: 600; font-size: 0.9em; margin-bottom: 0.2em; }

		/* Always show the kind eyebrow ("STATE" / "TRANSITION"); the flow hides it until hover. The
		   extra class specificity wins over the flow's default without !important. */
		.pict-flow-node .pict-flow-node-type-label { opacity: 1; }
	`,

	Templates:
	[
		{
			Hash: 'Workflow-Map-Container',
			Template: /*html*/`
<div class="wfmap" id="WFMap-Root-{~D:AppData.WorkflowMap.ViewID~}">
	<div class="wfmap-head">
		<h2 class="wfmap-title">{~D:AppData.WorkflowMap.TypeName~}<small>{~D:AppData.WorkflowMap.OriginLabel~}</small></h2>
		<div class="wfmap-toolbar" id="WFMap-Toolbar-{~D:AppData.WorkflowMap.ViewID~}"></div>
	</div>
	<div class="wfmap-banner" id="WFMap-Banner-{~D:AppData.WorkflowMap.ViewID~}"></div>
	<div class="wfmap-flow" id="WFMap-Flow-{~D:AppData.WorkflowMap.ViewID~}"></div>
	<datalist id="WFMap-Lanes">{~TS:Workflow-Map-Option:AppData.WorkflowMap.LaneOptions~}</datalist>
	<datalist id="WFMap-Entitlements">{~TS:Workflow-Map-Option:AppData.WorkflowMap.EntitlementOptions~}</datalist>
</div>`
		},
		{ Hash: 'Workflow-Map-Option', Template: /*html*/`<option value="{~D:Record.Value~}"></option>` },
			{ Hash: 'Workflow-Map-Layout-Option', Template: /*html*/`<option value="{~D:Record.Value~}" {~NE:Record.Selected^selected~}>{~D:Record.Label~}</option>` },
		{
			Hash: 'Workflow-Map-Toolbar',
			Template: /*html*/`
{~TS:Workflow-Map-Toolbar-View:AppData.WorkflowMap.ViewSlot~}
{~TS:Workflow-Map-Toolbar-Edit:AppData.WorkflowMap.EditSlot~}`
		},
		{
			Hash: 'Workflow-Map-Toolbar-View',
			Template: /*html*/`
<span class="wfmap-readonly-note">Built-in, read-only.</span>
<button class="wfmap-btn wfmap-btn-primary" onclick="_Pict.views['{~D:AppData.WorkflowMap.ViewID~}'].adopt()">Adopt to edit</button>
<label class="wfmap-arrange"><span class="wfmap-arrange-label">Arrange</span><select class="wfmap-select" onchange="_Pict.views['{~D:AppData.WorkflowMap.ViewID~}'].applyNamedLayout(this.value)">{~TS:Workflow-Map-Layout-Option:AppData.WorkflowMap.LayoutOptions~}</select></label>
<button class="wfmap-btn" onclick="_Pict.views['{~D:AppData.WorkflowMap.ViewID~}'].toggleExpanded()">{~D:AppData.WorkflowMap.ExpandLabel~}</button>
<span class="wfmap-hint">Double-click a state or transition to inspect it.</span>`
		},
		{
			Hash: 'Workflow-Map-Toolbar-Edit',
			Template: /*html*/`
<button class="wfmap-btn" onclick="_Pict.views['{~D:AppData.WorkflowMap.ViewID~}'].addState()">Add state</button>
<button class="wfmap-btn" onclick="_Pict.views['{~D:AppData.WorkflowMap.ViewID~}'].addTransition()">Add transition</button>
<button class="wfmap-btn" onclick="_Pict.views['{~D:AppData.WorkflowMap.ViewID~}'].deleteSelected()">Delete selected</button>
<label class="wfmap-arrange"><span class="wfmap-arrange-label">Arrange</span><select class="wfmap-select" onchange="_Pict.views['{~D:AppData.WorkflowMap.ViewID~}'].applyNamedLayout(this.value)">{~TS:Workflow-Map-Layout-Option:AppData.WorkflowMap.LayoutOptions~}</select></label>
<button class="wfmap-btn" onclick="_Pict.views['{~D:AppData.WorkflowMap.ViewID~}'].toggleExpanded()">{~D:AppData.WorkflowMap.ExpandLabel~}</button>
<button class="wfmap-btn" onclick="_Pict.views['{~D:AppData.WorkflowMap.ViewID~}'].saveCurrentLayout()">Save layout</button>
<button class="wfmap-btn wfmap-btn-primary" onclick="_Pict.views['{~D:AppData.WorkflowMap.ViewID~}'].save()">Save workflow</button>
<span class="wfmap-hint">Double-click a card to edit it. Wire a transition: drag a state's right port to the transition's In, and its Out to the next state's left port.</span>`
		},
		{
			Hash: 'Workflow-Map-Banner',
			Template: /*html*/`
{~TS:Workflow-Map-Errors:AppData.WorkflowMap.ErrorSlot~}
{~TS:Workflow-Map-Status:AppData.WorkflowMap.StatusSlot~}`
		},
		{
			Hash: 'Workflow-Map-Errors',
			Template: /*html*/`<div class="wfmap-errors"><strong>This workflow will not save yet:</strong><ul>{~TS:Workflow-Map-Error-Row:AppData.WorkflowMap.Errors~}</ul></div>`
		},
		{ Hash: 'Workflow-Map-Error-Row', Template: /*html*/`<li>{~D:Record.Message~}</li>` },
		{ Hash: 'Workflow-Map-Status', Template: /*html*/`<div class="wfmap-status">{~D:Record.Message~}</div>` }
	],

	Renderables:
	[
		{ RenderableHash: 'Workflow-Map-Container', TemplateHash: 'Workflow-Map-Container', DestinationAddress: '#Workflow-Map-Container', RenderMethod: 'replace' }
	]
};

class PictViewWorkflowMap extends libPictView
{
	constructor(pFable, pOptions, pServiceHash)
	{
		super(pFable, pOptions, pServiceHash);
		this._FlowView = null;
		this._Meta = { Key: null, Name: null };
	}

	onBeforeInitialize()
	{
		this._initState();
		return super.onBeforeInitialize();
	}

	_initState()
	{
		if (!this.pict.AppData.WorkflowMap)
		{
			this.pict.AppData.WorkflowMap =
			{
				ViewID: this.options.ViewIdentifier,
				TypeRecord: null,
				TypeName: 'Workflow',
				OriginLabel: '',
				Mode: 'empty',
				DisabledAttr: '',
				Dirty: false,
				ViewSlot: [], EditSlot: [],
				ErrorSlot: [], StatusSlot: [], Errors: [],
				LaneOptions: [],
				EntitlementOptions: [],
				Expanded: false,
				ExpandLabel: 'Show details',
				LayoutChoice: 'workflow',
				LayoutOptions: []
			};
		}
		this.pict.AppData.WorkflowMap.ViewID = this.options.ViewIdentifier;
		this._refreshLayoutOptions();
	}

	/**
	 * Rebuild the arrange-menu option list, flagging the active choice as selected so the dropdown
	 * keeps showing the last-applied layout across toolbar re-renders.
	 */
	_refreshLayoutOptions()
	{
		let tmpChoice = this._state().LayoutChoice || 'workflow';
		this._state().LayoutOptions = _LAYOUT_CHOICES.map(
			(pChoice) => ({ Value: pChoice.Value, Label: pChoice.Label, Selected: (pChoice.Value === tmpChoice) }));
	}

	_state() { return this.pict.AppData.WorkflowMap; }

	_client()
	{
		if (this.options.Client) { return this.options.Client; }
		let tmpName = this.options.ClientProvider || 'WorkflowAPI';
		return (this.pict.providers && this.pict.providers[tmpName]) || null;
	}

	_modal() { return this.pict.views['Pict-Section-Modal'] || null; }

	// -- opening a type --------------------------------------------------------

	/**
	 * Open a type record (from the catalog) in the map. Built-ins open read-only; owned types open
	 * editable. Pulls the full definition and the saved layout through the client, then renders.
	 */
	showType(pTypeRecord)
	{
		let tmpState = this._state();
		tmpState.TypeRecord = pTypeRecord || null;
		tmpState.TypeName = (pTypeRecord && pTypeRecord.Name) || 'Workflow';
		let tmpIsBuiltIn = !!(pTypeRecord && pTypeRecord.Origin === 'builtin');
		tmpState.Mode = tmpIsBuiltIn ? 'view' : 'edit';
		tmpState.OriginLabel = tmpIsBuiltIn ? 'built-in' : 'your workflow';
		tmpState.Errors = []; tmpState.ErrorSlot = []; tmpState.StatusSlot = [];

		let tmpClient = this._client();
		let tmpID = pTypeRecord && pTypeRecord.ID;
		let tmpDefinition = (pTypeRecord && pTypeRecord.WorkflowDefinition) || null;

		let tmpDefinitionPromise = tmpDefinition ? Promise.resolve(tmpDefinition)
			: (tmpClient && tmpID != null ? tmpClient.getType(tmpID).then((pType) => (pType && pType.WorkflowDefinition) || null) : Promise.resolve(null));
		let tmpLayoutPromise = (tmpClient && tmpID != null && tmpClient.getLayout) ? tmpClient.getLayout(tmpID).catch(() => ({})) : Promise.resolve({});

		return Promise.all([tmpDefinitionPromise, tmpLayoutPromise]).then((pResults) =>
		{
			let tmpDef = pResults[0] || { Key: 'workflow', Name: tmpState.TypeName, States: [], Transitions: [] };
			this._Meta = { Key: tmpDef.Key, Name: tmpDef.Name };
			this._PendingDefinition = tmpDef;
			this._PendingLayout = pResults[1] || {};
			tmpState.Dirty = false;
			this.render();
		});
	}

	// -- lifecycle / embedding -------------------------------------------------

	onAfterRender(pRenderable, pRenderDestinationAddress, pRecord, pContent)
	{
		this._ensureFlowView();
		if (this._PendingDefinition)
		{
			this._loadFlow(this._PendingDefinition, this._PendingLayout);
			this._PendingDefinition = null; this._PendingLayout = null;
		}
		this._applyMode();
		this._renderToolbar();
		this._renderBanner();
		this.pict.CSSMap.injectCSS();
		return super.onAfterRender(pRenderable, pRenderDestinationAddress, pRecord, pContent);
	}

	_ensureFlowView()
	{
		let tmpID = this.options.ViewIdentifier;
		let tmpContainer = '#WFMap-Flow-' + tmpID;
		if (!this._FlowView)
		{
			let tmpNodeTypes = {};
			[ new libStateCard(this.fable, {}, 'Workflow-StateCard'), new libTransitionCard(this.fable, {}, 'Workflow-TransitionCard') ].forEach((pCard) =>
			{
				let tmpConfig = pCard.getNodeTypeConfiguration();
				tmpNodeTypes[tmpConfig.Hash] = tmpConfig;
			});

			this._FlowView = this.pict.addView('Workflow-Flow-' + tmpID,
				{
					ViewIdentifier: 'Workflow-Flow-' + tmpID,
					DefaultRenderable: 'Flow-Container',
					DefaultDestinationAddress: tmpContainer,
					AutoRender: false,
					EnableToolbar: false,
					EnableConnectionCreation: true,
					EnableNodeDragging: true,
					IncludeDefaultNodeTypes: false,
					DefaultNodeType: libDefinitionFlow.STATE_NODE_TYPE,
					NodeTypes: tmpNodeTypes,
					// Connections attach to the perimeter point nearest the other card, so an edge
					// leaves a state from the side that faces its transition rather than a fixed port.
					DefaultEdgeTheme: 'Perimeter',
					Renderables: [ { RenderableHash: 'Flow-Container', TemplateHash: 'Flow-Container-Template', DestinationAddress: tmpContainer, RenderMethod: 'replace' } ]
				},
				libPictSectionFlow);
		}
		this._FlowView.initialRenderComplete = false;
		this._FlowView.render();
		this._registerCardIcons();
		this._wireFlowEvents();
	}

	// Register the State/Transition title-bar glyphs on the flow's icon provider (once). Done after
	// the flow renders so the provider exists, and before any nodes load so the glyphs are available.
	_registerCardIcons()
	{
		if (this._IconsRegistered) { return; }
		let tmpIconProvider = this._FlowView && this._FlowView._IconProvider;
		if (!tmpIconProvider || typeof tmpIconProvider.registerIcon !== 'function') { return; }
		tmpIconProvider.registerIcon('WorkflowState', _STATE_ICON);
		tmpIconProvider.registerIcon('WorkflowTransition', _TRANSITION_ICON);
		this._IconsRegistered = true;
	}

	_wireFlowEvents()
	{
		let tmpEvents = this._FlowView._EventHandlerProvider;
		if (!tmpEvents || this._FlowEventsWired) { return; }
		this._FlowEventsWired = true;
		tmpEvents.registerHandler('onFlowChanged', () => this._markDirty());
		tmpEvents.registerHandler('onNodeMoved', () => this._markDirty());
		// Wiring a transition card changes which states it joins, so re-stamp its From/To labels.
		tmpEvents.registerHandler('onConnectionCreated', () => { this._markDirty(); this._stampTransitionDisplayFields(); this._refreshOptionLists(); });
		// A panel edits the underlying node live; on close, repaint so a renamed/re-laned state and
		// a re-gated transition show their new title and color, and refresh the autocomplete lists.
		tmpEvents.registerHandler('onPanelClosed', () => this._afterPanelEdit());
	}

	_loadFlow(pDefinition, pLayout)
	{
		let tmpFlow = libDefinitionFlow.definitionToFlow(pDefinition, pLayout || {});
		this._FlowView.setFlowData({ Nodes: tmpFlow.Nodes, Connections: tmpFlow.Connections });
		this._stampTransitionDisplayFields();
		this._refreshOptionLists();
		// With no saved arrangement, lay it out staggered so it reads instead of bunching.
		if (!pLayout || Object.keys(pLayout).length === 0) { this._staggeredLayout(); }
	}

	_applyMode()
	{
		let tmpState = this._state();
		let tmpEditable = (tmpState.Mode === 'edit');
		tmpState.DisabledAttr = tmpEditable ? '' : 'disabled';
		tmpState.ViewSlot = (tmpState.Mode === 'view') ? [{}] : [];
		tmpState.EditSlot = tmpEditable ? [{}] : [];
		// Read-only graphs still pan/zoom and open panels for reading, but no structural edits.
		if (this._FlowView)
		{
			this._FlowView.options.EnableConnectionCreation = tmpEditable;
			this._FlowView.options.EnableNodeDragging = tmpEditable;
		}
	}

	// -- editing (called from the on-graph panels, by node hash) ---------------

	editState(pHash, pField, pValue)
	{
		if (this._state().Mode !== 'edit') { return; }
		let tmpNode = this._FlowView.getNode(pHash); if (!tmpNode) { return; }
		if (pField === 'Name') { tmpNode.Title = pValue; }
		else if (pField === 'IsInitial' || pField === 'IsTerminal') { if (pValue) { tmpNode.Data[pField] = true; } else { delete tmpNode.Data[pField]; } }
		else { if (pValue) { tmpNode.Data[pField] = pValue; } else { delete tmpNode.Data[pField]; } }
		this._markDirty();
	}

	editTransition(pHash, pField, pValue)
	{
		if (this._state().Mode !== 'edit') { return; }
		let tmpNode = this._FlowView.getNode(pHash); if (!tmpNode) { return; }
		if (pValue) { tmpNode.Data[pField] = pValue; } else { delete tmpNode.Data[pField]; }
		this._markDirty();
	}

	editTransitionGuard(pHash, pValue)
	{
		if (this._state().Mode !== 'edit') { return; }
		let tmpNode = this._FlowView.getNode(pHash); if (!tmpNode) { return; }
		tmpNode.Data._GuardText = pValue;
		this._markDirty();
	}

	// -- toolbar actions -------------------------------------------------------

	addState()
	{
		if (this._state().Mode !== 'edit') { return; }
		let tmpNode = this._FlowView.addNode(libDefinitionFlow.STATE_NODE_TYPE, 80, 80, 'New State', { Key: '' });
		this._markDirty();
		if (tmpNode) { this._FlowView.selectNode(tmpNode.Hash); }
	}

	addTransition()
	{
		if (this._state().Mode !== 'edit') { return; }
		let tmpNode = this._FlowView.addNode(libDefinitionFlow.TRANSITION_NODE_TYPE, 200, 200, 'open', {});
		this._markDirty();
		if (tmpNode) { this._FlowView.selectNode(tmpNode.Hash); }
	}

	deleteSelected()
	{
		if (this._state().Mode !== 'edit') { return; }
		this._FlowView.deleteSelected();
		this._stampTransitionDisplayFields();
		this._refreshOptionLists();
		this._markDirty();
	}

	autoArrange()
	{
		this.applyNamedLayout(this._state().LayoutChoice || 'workflow');
	}

	/**
	 * Apply a layout from the arrange menu. 'workflow' runs the bespoke, workflow-aware stairstep;
	 * any other value is the name of a pict-section-flow layout algorithm, run over the whole graph
	 * and framed with zoom-to-fit. Either way the new positions are dirty until the layout is saved.
	 */
	applyNamedLayout(pChoice)
	{
		let tmpChoice = pChoice || 'workflow';
		this._state().LayoutChoice = tmpChoice;
		this._refreshLayoutOptions();

		let tmpEntry = _LAYOUT_CHOICES.find((pEntry) => pEntry.Value === tmpChoice);
		if (!tmpEntry || !tmpEntry.Algorithm)
		{
			this._staggeredLayout();
		}
		else if (this._FlowView)
		{
			this._FlowView.autoLayout(tmpEntry.Algorithm);
			if (typeof this._FlowView.zoomToFit === 'function') { this._FlowView.zoomToFit(); }
		}

		this._markDirty();
		this._renderToolbar();
	}

	/**
	 * A workflow-aware staggered layout: walk the states from the initial one (breadth first), lay
	 * them left to right, and alternate each between two rows so the chain stair-steps and uses
	 * vertical space instead of one long line. Each state's outgoing transition cards sit just to its
	 * right, on its row, stacking when a state has several. The generic layered algorithm collapses
	 * on a workflow's branches and cycles, which is why this is bespoke.
	 */
	_staggeredLayout()
	{
		if (!this._FlowView) { return; }
		let tmpNodes = this._FlowView.flowData.Nodes || [];
		let tmpConnections = this._FlowView.flowData.Connections || [];
		let tmpTransitionType = libDefinitionFlow.TRANSITION_NODE_TYPE;

		let tmpNodeByHash = {};
		let tmpIsTransition = {};
		tmpNodes.forEach((pNode) => { tmpNodeByHash[pNode.Hash] = pNode; if (pNode.Type === tmpTransitionType) { tmpIsTransition[pNode.Hash] = true; } });

		// Each transition card's source and target state, from the edges around it.
		let tmpSourceOf = {};
		let tmpTargetOf = {};
		tmpConnections.forEach((pConnection) =>
		{
			if (tmpIsTransition[pConnection.TargetNodeHash]) { tmpSourceOf[pConnection.TargetNodeHash] = pConnection.SourceNodeHash; }
			if (tmpIsTransition[pConnection.SourceNodeHash]) { tmpTargetOf[pConnection.SourceNodeHash] = pConnection.TargetNodeHash; }
		});

		// state hash -> [{ transition node, target state hash }]
		let tmpAdjacency = {};
		tmpNodes.forEach((pNode) => { if (pNode.Type !== tmpTransitionType) { tmpAdjacency[pNode.Hash] = []; } });
		tmpNodes.forEach((pNode) =>
		{
			if (pNode.Type !== tmpTransitionType) { return; }
			let tmpSource = tmpSourceOf[pNode.Hash];
			if (tmpSource != null && tmpAdjacency[tmpSource]) { tmpAdjacency[tmpSource].push({ Transition: pNode, Target: tmpTargetOf[pNode.Hash] }); }
		});

		// Breadth-first order of the states from the initial state.
		let tmpStateNodes = tmpNodes.filter((pNode) => pNode.Type !== tmpTransitionType);
		let tmpInitial = tmpStateNodes.find((pNode) => pNode.Data && pNode.Data.IsInitial) || tmpStateNodes[0];
		let tmpOrder = [];
		let tmpSeen = {};
		let tmpQueue = tmpInitial ? [tmpInitial.Hash] : tmpStateNodes.map((pNode) => pNode.Hash);
		while (tmpQueue.length)
		{
			let tmpHash = tmpQueue.shift();
			if (tmpSeen[tmpHash]) { continue; }
			tmpSeen[tmpHash] = true;
			tmpOrder.push(tmpHash);
			(tmpAdjacency[tmpHash] || []).forEach((pEdge) => { if (pEdge.Target != null && !tmpSeen[pEdge.Target]) { tmpQueue.push(pEdge.Target); } });
		}
		tmpStateNodes.forEach((pNode) => { if (!tmpSeen[pNode.Hash]) { tmpSeen[pNode.Hash] = true; tmpOrder.push(pNode.Hash); } });

		// Place states left to right, alternating two rows; place each state's transitions to its right.
		// The column and row steps leave room for a state's transition stack plus the edges that route
		// around a hub state (one that several transitions point back into). A state's transitions are
		// centered on the state's own vertical center, not hung downward from its top, so a two- or
		// three-way fan-out straddles the state and stays clear of the other row.
		let tmpColumnStep = 460;
		let tmpRowStep = 260;
		let tmpStartX = 60;
		let tmpStartY = 100;
		let tmpTransitionGap = 44;
		tmpOrder.forEach((pHash, pIndex) =>
		{
			let tmpNode = tmpNodeByHash[pHash];
			if (!tmpNode) { return; }
			let tmpRow = pIndex % 2;
			tmpNode.X = tmpStartX + pIndex * tmpColumnStep;
			tmpNode.Y = tmpStartY + tmpRow * tmpRowStep;

			let tmpEdges = tmpAdjacency[pHash] || [];
			let tmpStateCenter = tmpNode.Y + (tmpNode.Height || 70) / 2;
			tmpEdges.forEach((pEdge, pEdgeIndex) =>
			{
				let tmpTransition = pEdge.Transition;
				let tmpTransitionHeight = tmpTransition.Height || 64;
				let tmpPitch = tmpTransitionHeight + 30;
				tmpTransition.X = tmpNode.X + (tmpNode.Width || 190) + tmpTransitionGap;
				tmpTransition.Y = (tmpStateCenter - (tmpTransitionHeight / 2)) + ((pEdgeIndex - ((tmpEdges.length - 1) / 2)) * tmpPitch);
			});
		});

		this._FlowView.renderFlow();
		if (typeof this._FlowView.zoomToFit === 'function') { this._FlowView.zoomToFit(); }
	}

	/**
	 * The expanded view: open every card's panel and place it clear of the graph (panels for the
	 * upper row go above their card, lower-row panels go below), so the flow can be read terse
	 * (cards only) or in full (every gate and field visible, proximal to its card). Toggles closed.
	 */
	toggleExpanded()
	{
		let tmpState = this._state();
		if (tmpState.Expanded) { this._closeAllPanels(); tmpState.Expanded = false; tmpState.ExpandLabel = 'Show details'; }
		else { this._openAllPanels(); tmpState.Expanded = true; tmpState.ExpandLabel = 'Hide details'; }
		this._renderToolbar();
	}

	_openAllPanels()
	{
		if (!this._FlowView) { return; }
		let tmpNodes = (this._FlowView.flowData.Nodes || []).slice();
		if (!tmpNodes.length) { return; }
		let tmpYs = tmpNodes.map((pNode) => pNode.Y);
		let tmpMidY = (Math.min.apply(null, tmpYs) + Math.max.apply(null, tmpYs)) / 2;
		this._BulkPanelOp = true;
		tmpNodes.forEach((pNode) =>
		{
			let tmpPanel = this._FlowView.openPanel(pNode.Hash);
			if (!tmpPanel) { return; }
			tmpPanel.X = pNode.X - 30;
			tmpPanel.Y = (pNode.Y <= tmpMidY) ? (pNode.Y - (tmpPanel.Height || 250) - 40) : (pNode.Y + (pNode.Height || 70) + 40);
		});
		this._BulkPanelOp = false;
		this._FlowView.renderFlow();
	}

	_closeAllPanels()
	{
		if (!this._FlowView) { return; }
		this._BulkPanelOp = true;
		(this._FlowView.flowData.OpenPanels || []).slice().forEach((pPanel) => { this._FlowView.closePanel(pPanel.Hash); });
		this._BulkPanelOp = false;
	}

	saveCurrentLayout()
	{
		let tmpClient = this._client(); let tmpRecord = this._state().TypeRecord;
		if (!tmpClient || !tmpClient.saveLayout || !tmpRecord) { return; }
		tmpClient.saveLayout(tmpRecord.ID, this._collectLayout()).then(() =>
		{
			this._toast('Layout saved.', 'success');
		}).catch((pError) => this._toast('Could not save layout: ' + pError.message, 'error'));
	}

	save()
	{
		let tmpState = this._state();
		if (tmpState.Mode !== 'edit') { return; }
		let tmpClient = this._client(); let tmpRecord = tmpState.TypeRecord;
		if (!tmpClient || !tmpRecord) { return; }

		let tmpDefinition = this._currentDefinition();
		let tmpError = libDefinitionFlow.validateDefinition(tmpDefinition);
		if (tmpError)
		{
			tmpState.Errors = [{ Message: tmpError }];
			tmpState.ErrorSlot = [{}]; tmpState.StatusSlot = [];
			this._renderBanner();
			return;
		}
		tmpState.Errors = []; tmpState.ErrorSlot = [];
		tmpClient.saveType(tmpRecord.ID, tmpDefinition).then(() =>
		{
			tmpState.Dirty = false;
			tmpState.StatusSlot = [{ Message: 'Saved.' }];
			this._renderBanner();
			this._toast('Workflow saved.', 'success');
		}).catch((pError) =>
		{
			tmpState.Errors = [{ Message: pError.message }];
			tmpState.ErrorSlot = [{}];
			this._renderBanner();
		});
	}

	adopt()
	{
		let tmpClient = this._client(); let tmpRecord = this._state().TypeRecord;
		if (!tmpClient || !tmpRecord) { return; }
		let tmpModal = this._modal();
		let fProceed = () =>
		{
			tmpClient.adoptType(tmpRecord.ID).then((pClone) =>
			{
				this._toast('Adopted. Editing your copy.', 'success');
				this.showType(Object.assign({}, pClone, { Origin: 'owned' }));
			}).catch((pError) => this._toast('Could not adopt: ' + pError.message, 'error'));
		};
		if (tmpModal && typeof tmpModal.confirm === 'function')
		{
			tmpModal.confirm('This copies the built-in into your workflows so you can edit it. The built-in stays unchanged.',
				{ title: 'Adopt ' + (tmpRecord.Name || 'workflow') + '?', confirmLabel: 'Adopt', cancelLabel: 'Cancel' }).then((pOk) => { if (pOk) { fProceed(); } });
		}
		else { fProceed(); }
	}

	// -- helpers ---------------------------------------------------------------

	_currentDefinition()
	{
		let tmpFlow = this._FlowView.getFlowData();
		// The transition panel edits the guard as JSON text (_GuardText); fold it back into the
		// structured Data.Guard on each transition node before reading the definition. Invalid JSON
		// becomes a guard the engine rejects, so the save surfaces a clear error.
		(tmpFlow.Nodes || []).forEach((pNode) =>
		{
			if (pNode.Type !== libDefinitionFlow.TRANSITION_NODE_TYPE) { return; }
			let tmpData = pNode.Data || {};
			if (Object.prototype.hasOwnProperty.call(tmpData, '_GuardText'))
			{
				let tmpText = String(tmpData._GuardText || '').trim();
				if (!tmpText) { delete tmpData.Guard; }
				else { try { tmpData.Guard = JSON.parse(tmpText); } catch (pError) { tmpData.Guard = { _invalid: tmpText }; } }
			}
		});
		return libDefinitionFlow.flowToDefinition(tmpFlow, this._Meta);
	}

	// Save only state positions; transition cards center themselves between their states on load.
	_collectLayout()
	{
		let tmpFlow = this._FlowView.getFlowData();
		let tmpLayout = {};
		(tmpFlow.Nodes || []).forEach((pNode) =>
		{
			if (pNode.Type === libDefinitionFlow.TRANSITION_NODE_TYPE) { return; }
			let tmpKey = (pNode.Data && pNode.Data.Key) || pNode.Hash;
			tmpLayout[tmpKey] = { X: pNode.X, Y: pNode.Y };
		});
		return tmpLayout;
	}

	// Repaint after a panel closes: recolor lanes (a state may have changed lane), re-stamp the
	// transition cards (titles + From/To), re-render, refresh autocomplete, and mark dirty.
	_afterPanelEdit()
	{
		if (this._BulkPanelOp) { return; }
		this._recolorLanes();
		this._stampTransitionDisplayFields();
		this._refreshOptionLists();
		if (this._FlowView) { this._FlowView.renderFlow(); }
		this._markDirty();
	}

	// After a lane edit, recolor every state so a lane keeps one consistent color.
	_recolorLanes()
	{
		if (!this._FlowView) { return; }
		let tmpDefinition = this._currentDefinition();
		let tmpColors = libDefinitionFlow.laneColors(tmpDefinition);
		(this._FlowView.flowData.Nodes || []).forEach((pNode) =>
		{
			if (pNode.Type === libDefinitionFlow.TRANSITION_NODE_TYPE) { return; }
			let tmpLane = (pNode.Data && pNode.Data.Lane) || (pNode.Data && pNode.Data.Key) || pNode.Hash;
			if (tmpColors[tmpLane]) { pNode.TitleBarColor = tmpColors[tmpLane]; }
		});
	}

	// Give each transition card the names of the states it joins (for its panel header) and a title
	// showing its gate, and seed the guard JSON text. These are display-only; flowToDefinition reads
	// From/To from the edges and the guard from Data.Guard, so none of this reaches the definition.
	_stampTransitionDisplayFields()
	{
		if (!this._FlowView) { return; }
		let tmpNodes = this._FlowView.flowData.Nodes || [];
		let tmpConnections = this._FlowView.flowData.Connections || [];
		let tmpNameByHash = {};
		let tmpIsTransition = {};
		tmpNodes.forEach((pNode) =>
		{
			tmpNameByHash[pNode.Hash] = pNode.Title || ((pNode.Data && pNode.Data.Key) || pNode.Hash);
			if (pNode.Type === libDefinitionFlow.TRANSITION_NODE_TYPE) { tmpIsTransition[pNode.Hash] = true; }
		});
		let tmpIncoming = {};
		let tmpOutgoing = {};
		tmpConnections.forEach((pConnection) =>
		{
			if (tmpIsTransition[pConnection.TargetNodeHash]) { tmpIncoming[pConnection.TargetNodeHash] = pConnection.SourceNodeHash; }
			if (tmpIsTransition[pConnection.SourceNodeHash]) { tmpOutgoing[pConnection.SourceNodeHash] = pConnection.TargetNodeHash; }
		});
		tmpNodes.forEach((pNode) =>
		{
			if (pNode.Type !== libDefinitionFlow.TRANSITION_NODE_TYPE) { return; }
			if (!pNode.Data) { pNode.Data = {}; }
			pNode.Data._FromName = tmpNameByHash[tmpIncoming[pNode.Hash]] || '(unwired)';
			pNode.Data._ToName = tmpNameByHash[tmpOutgoing[pNode.Hash]] || '(unwired)';
			if (!Object.prototype.hasOwnProperty.call(pNode.Data, '_GuardText'))
			{
				pNode.Data._GuardText = pNode.Data.Guard ? JSON.stringify(pNode.Data.Guard, null, 2) : '';
			}
			pNode.Title = libDefinitionFlow.transitionTitle(pNode.Data);
		});
	}

	// Refresh the lane + entitlement autocomplete lists from the current graph.
	_refreshOptionLists()
	{
		let tmpDefinition = this._currentDefinition();
		let tmpState = this._state();
		tmpState.LaneOptions = libDefinitionFlow.lanesOf(tmpDefinition).map((pLane) => ({ Value: pLane }));
		let tmpEntitlements = {};
		(tmpDefinition.Transitions || []).forEach((pTransition) => { if (pTransition.RequiresEntitlement) { tmpEntitlements[pTransition.RequiresEntitlement] = true; } });
		tmpState.EntitlementOptions = Object.keys(tmpEntitlements).map((pEntitlement) => ({ Value: pEntitlement }));
	}

	// -- one-shot region renders (outside the renderable cycle) ----------------

	_renderRegion(pContainerSuffix, pTemplateHash)
	{
		let tmpSelector = '#WFMap-' + pContainerSuffix + '-' + this.options.ViewIdentifier;
		let tmpElement = this.pict.ContentAssignment.getElement(tmpSelector);
		if (!tmpElement || (Array.isArray(tmpElement) && tmpElement.length < 1)) { return; }
		let tmpHTML = this.pict.parseTemplateByHash(pTemplateHash, { ViewIdentifier: this.options.ViewIdentifier });
		this.pict.ContentAssignment.assignContent(tmpSelector, tmpHTML);
	}

	_renderToolbar() { this._renderRegion('Toolbar', 'Workflow-Map-Toolbar'); }
	_renderBanner() { this._renderRegion('Banner', 'Workflow-Map-Banner'); }

	_markDirty() { this._state().Dirty = true; }

	_toast(pMessage, pType)
	{
		let tmpModal = this._modal();
		if (tmpModal && typeof tmpModal.toast === 'function') { tmpModal.toast(pMessage, { type: pType || 'info' }); }
	}
}

module.exports = PictViewWorkflowMap;
module.exports.default_configuration = _ViewConfiguration;
