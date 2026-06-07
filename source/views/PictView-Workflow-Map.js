'use strict';

/**
 * Workflow map / designer.
 *
 * The centerpiece: a workflow definition rendered as a node-and-edge graph on pict-section-flow.
 * States are nodes (a StateCard, colored by lane), transitions are connections, and an inspector
 * on the right edits whatever is selected: a state's Name, Lane, Marker, IsInitial, IsTerminal;
 * a transition's RequiresEntitlement, ActorAddress, and structured Guard. The graph is the
 * definition: reading it back (flowToDefinition) takes From and To from the wires.
 *
 * Built-in (platform) types open read-only; the first move to edit one offers to adopt it (clone
 * into the tenant) and edits the clone. Before a save, the assembled definition runs through the
 * engine's own defineWorkflow checks, and a failure is shown rather than persisted. Node
 * positions save and restore as a per-type layout through the client; positions are not part of
 * the definition.
 *
 * Everything talks to an injected client (the WorkflowClient shape). The host supplies it as
 * options.Client (an object) or names a provider in options.ClientProvider (default 'WorkflowAPI').
 *
 * @author Steven Velozo <steven@velozo.com>
 * @license MIT
 */

const libPictView = require('pict-view');
const libPictSectionFlow = require('pict-section-flow');
const libDefinitionFlow = require('../Definition-Flow.js');
const libStateCard = require('../cards/State-Card.js');

let _OPERATORS = ['==', '===', '!=', '>', '>=', '<', '<=', 'in', 'nin', 'exists', 'empty', 'truthy', 'falsy', 'includesAny', 'includesAll', 'countGte'];
try { let tmpGuards = require('fable-workflow').WorkflowGuards; if (tmpGuards && Array.isArray(tmpGuards.OPERATORS)) { _OPERATORS = tmpGuards.OPERATORS; } } catch (pError) { /* keep the fallback list */ }

const _ViewConfiguration =
{
	ViewIdentifier: 'Workflow-Map',
	DefaultRenderable: 'Workflow-Map-Container',
	DefaultDestinationAddress: '#Workflow-Map-Container',
	AutoRender: false,

	// How the view finds its API client.
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
		.wfmap-btn[disabled] { opacity: 0.5; cursor: default; }
		.wfmap-body { display: flex; flex: 1; min-height: 0; gap: 0.6em; }
		.wfmap-flow { flex: 1; min-height: 520px; border: 1px solid var(--theme-color-border-light, #e3e3e3); border-radius: 6px; overflow: hidden; }
		.wfmap-inspector { width: 320px; flex-shrink: 0; border: 1px solid var(--theme-color-border-light, #e3e3e3); border-radius: 6px; padding: 0.75em; overflow-y: auto; background: var(--theme-color-background-panel, #fff); }
		.wfmap-inspector h3 { margin: 0 0 0.5em; font-size: 1em; display: flex; align-items: center; justify-content: space-between; }
		.wfmap-inspector-empty { color: var(--theme-color-text-secondary, #888); font-size: 0.9em; line-height: 1.5; }
		.wfmap-field { margin-bottom: 0.6em; }
		.wfmap-field label { display: block; font-size: 0.78em; font-weight: 600; color: var(--theme-color-text-secondary, #666); margin-bottom: 0.2em; text-transform: uppercase; letter-spacing: 0.03em; }
		.wfmap-field input[type=text], .wfmap-field select, .wfmap-field textarea { width: 100%; box-sizing: border-box; padding: 0.4em; border: 1px solid var(--theme-color-border-default, #ccc); border-radius: 4px; font-size: 0.9em; font-family: inherit; }
		.wfmap-field textarea { min-height: 90px; resize: vertical; font-family: monospace; font-size: 0.82em; }
		.wfmap-check { display: flex; align-items: center; gap: 0.4em; font-size: 0.9em; margin-bottom: 0.4em; }
		.wfmap-check input { margin: 0; }
		.wfmap-flag { display: inline-block; font-size: 0.72em; padding: 0.1em 0.45em; border-radius: 3px; background: var(--theme-color-background-tertiary, #eee); color: var(--theme-color-text-secondary, #555); margin-left: 0.4em; }
		.wfmap-guard-leaf { display: grid; grid-template-columns: 1fr 0.8fr 1fr auto; gap: 0.3em; margin-bottom: 0.3em; align-items: center; }
		.wfmap-guard-leaf input { padding: 0.3em; font-size: 0.82em; }
		.wfmap-leaf-remove { border: none; background: none; cursor: pointer; color: var(--theme-color-status-error, #c0392b); font-size: 1.1em; line-height: 1; }
		.wfmap-banner { flex-shrink: 0; }
		.wfmap-errors { margin: 0.5em 0 0; padding: 0.5em 0.75em; border-radius: 5px; background: var(--theme-color-status-error-background, #fdecea); border: 1px solid var(--theme-color-status-error, #e74c3c); color: var(--theme-color-status-error, #c0392b); font-size: 0.85em; }
		.wfmap-errors ul { margin: 0.3em 0 0; padding-left: 1.2em; }
		.wfmap-status { margin: 0.5em 0 0; font-size: 0.85em; color: var(--theme-color-text-secondary, #666); }
		.wfmap-readonly-note { font-size: 0.82em; color: var(--theme-color-text-secondary, #888); }
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
	<div class="wfmap-body">
		<div class="wfmap-flow" id="WFMap-Flow-{~D:AppData.WorkflowMap.ViewID~}"></div>
		<div class="wfmap-inspector" id="WFMap-Inspector-{~D:AppData.WorkflowMap.ViewID~}"></div>
	</div>
	<datalist id="WFMap-Operators">{~TS:Workflow-Map-Option:AppData.WorkflowMap.OperatorOptions~}</datalist>
	<datalist id="WFMap-Lanes">{~TS:Workflow-Map-Option:AppData.WorkflowMap.LaneOptions~}</datalist>
	<datalist id="WFMap-Entitlements">{~TS:Workflow-Map-Option:AppData.WorkflowMap.EntitlementOptions~}</datalist>
</div>`
		},
		{ Hash: 'Workflow-Map-Option', Template: /*html*/`<option value="{~D:Record.Value~}"></option>` },
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
<button class="wfmap-btn" onclick="_Pict.views['{~D:AppData.WorkflowMap.ViewID~}'].autoArrange()">Auto-arrange</button>`
		},
		{
			Hash: 'Workflow-Map-Toolbar-Edit',
			Template: /*html*/`
<button class="wfmap-btn" onclick="_Pict.views['{~D:AppData.WorkflowMap.ViewID~}'].addState()">Add state</button>
<button class="wfmap-btn" onclick="_Pict.views['{~D:AppData.WorkflowMap.ViewID~}'].autoArrange()">Auto-arrange</button>
<button class="wfmap-btn" onclick="_Pict.views['{~D:AppData.WorkflowMap.ViewID~}'].saveCurrentLayout()">Save layout</button>
<button class="wfmap-btn wfmap-btn-primary" onclick="_Pict.views['{~D:AppData.WorkflowMap.ViewID~}'].save()">Save workflow</button>`
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
		{ Hash: 'Workflow-Map-Status', Template: /*html*/`<div class="wfmap-status">{~D:Record.Message~}</div>` },
		{
			Hash: 'Workflow-Map-Inspector',
			Template: /*html*/`
{~TS:Workflow-Map-Inspector-Empty:AppData.WorkflowMap.Inspector.EmptySlot~}
{~TS:Workflow-Map-Inspector-State:AppData.WorkflowMap.Inspector.StateSlot~}
{~TS:Workflow-Map-Inspector-Transition:AppData.WorkflowMap.Inspector.TransitionSlot~}`
		},
		{
			Hash: 'Workflow-Map-Inspector-Empty',
			Template: /*html*/`<div class="wfmap-inspector-empty">{~D:Record.Hint~}</div>`
		},
		{
			Hash: 'Workflow-Map-Inspector-State',
			Template: /*html*/`
<h3>State<span class="wfmap-flag">{~D:Record.Key~}</span></h3>
<div class="wfmap-field"><label>Name</label><input type="text" value="{~D:Record.Name~}" {~D:AppData.WorkflowMap.DisabledAttr~} oninput="_Pict.views['{~D:AppData.WorkflowMap.ViewID~}'].editState('Name', this.value)"></div>
<div class="wfmap-field"><label>Lane</label><input type="text" list="WFMap-Lanes" value="{~D:Record.Lane~}" {~D:AppData.WorkflowMap.DisabledAttr~} oninput="_Pict.views['{~D:AppData.WorkflowMap.ViewID~}'].editState('Lane', this.value)"></div>
<div class="wfmap-field"><label>Marker</label><input type="text" value="{~D:Record.Marker~}" {~D:AppData.WorkflowMap.DisabledAttr~} oninput="_Pict.views['{~D:AppData.WorkflowMap.ViewID~}'].editState('Marker', this.value)"></div>
<label class="wfmap-check"><input type="checkbox" {~D:Record.InitialChecked~} {~D:AppData.WorkflowMap.DisabledAttr~} onchange="_Pict.views['{~D:AppData.WorkflowMap.ViewID~}'].editState('IsInitial', this.checked)"> Initial state</label>
<label class="wfmap-check"><input type="checkbox" {~D:Record.TerminalChecked~} {~D:AppData.WorkflowMap.DisabledAttr~} onchange="_Pict.views['{~D:AppData.WorkflowMap.ViewID~}'].editState('IsTerminal', this.checked)"> Terminal state</label>
{~TS:Workflow-Map-State-Delete:AppData.WorkflowMap.Inspector.DeleteSlot~}`
		},
		{
			Hash: 'Workflow-Map-State-Delete',
			Template: /*html*/`<div class="wfmap-field" style="margin-top:0.75em"><button class="wfmap-btn" onclick="_Pict.views['{~D:AppData.WorkflowMap.ViewID~}'].deleteSelected()">Remove state</button></div>`
		},
		{
			Hash: 'Workflow-Map-Inspector-Transition',
			Template: /*html*/`
<h3>Transition</h3>
<div class="wfmap-field"><label>Transition</label><div>{~D:Record.From~} to {~D:Record.To~}</div></div>
<div class="wfmap-field"><label>Requires entitlement</label><input type="text" list="WFMap-Entitlements" value="{~D:Record.RequiresEntitlement~}" {~D:AppData.WorkflowMap.DisabledAttr~} oninput="_Pict.views['{~D:AppData.WorkflowMap.ViewID~}'].editTransition('RequiresEntitlement', this.value)"></div>
<div class="wfmap-field"><label>Actor address</label><input type="text" value="{~D:Record.ActorAddress~}" {~D:AppData.WorkflowMap.DisabledAttr~} oninput="_Pict.views['{~D:AppData.WorkflowMap.ViewID~}'].editTransition('ActorAddress', this.value)"></div>
<div class="wfmap-field"><label>Readiness guard</label>
	<select {~D:AppData.WorkflowMap.DisabledAttr~} onchange="_Pict.views['{~D:AppData.WorkflowMap.ViewID~}'].setGuardMode(this.value)">
		<option value="none" {~D:Record.GuardModeNone~}>No guard</option>
		<option value="all" {~D:Record.GuardModeAll~}>All of</option>
		<option value="any" {~D:Record.GuardModeAny~}>Any of</option>
		<option value="raw" {~D:Record.GuardModeRaw~}>Raw JSON</option>
	</select>
</div>
{~TS:Workflow-Map-Guard-Leaves:AppData.WorkflowMap.Inspector.GuardLeavesSlot~}
{~TS:Workflow-Map-Guard-Raw:AppData.WorkflowMap.Inspector.GuardRawSlot~}`
		},
		{
			Hash: 'Workflow-Map-Guard-Leaves',
			Template: /*html*/`
<div>{~TS:Workflow-Map-Guard-Leaf:AppData.WorkflowMap.Inspector.Guard.Leaves~}</div>
{~TS:Workflow-Map-Guard-Add:AppData.WorkflowMap.Inspector.GuardAddSlot~}`
		},
		{
			Hash: 'Workflow-Map-Guard-Leaf',
			Template: /*html*/`
<div class="wfmap-guard-leaf">
	<input type="text" placeholder="address" value="{~D:Record.Address~}" {~D:AppData.WorkflowMap.DisabledAttr~} oninput="_Pict.views['{~D:AppData.WorkflowMap.ViewID~}'].editGuardLeaf({~D:Record.Index~}, 'Address', this.value)">
	<input type="text" list="WFMap-Operators" placeholder="op" value="{~D:Record.Op~}" {~D:AppData.WorkflowMap.DisabledAttr~} oninput="_Pict.views['{~D:AppData.WorkflowMap.ViewID~}'].editGuardLeaf({~D:Record.Index~}, 'Op', this.value)">
	<input type="text" placeholder="value" value="{~D:Record.Value~}" {~D:AppData.WorkflowMap.DisabledAttr~} oninput="_Pict.views['{~D:AppData.WorkflowMap.ViewID~}'].editGuardLeaf({~D:Record.Index~}, 'Value', this.value)">
	<button class="wfmap-leaf-remove" title="remove" {~D:AppData.WorkflowMap.DisabledAttr~} onclick="_Pict.views['{~D:AppData.WorkflowMap.ViewID~}'].removeGuardLeaf({~D:Record.Index~})">x</button>
</div>`
		},
		{
			Hash: 'Workflow-Map-Guard-Add',
			Template: /*html*/`<button class="wfmap-btn" {~D:AppData.WorkflowMap.DisabledAttr~} onclick="_Pict.views['{~D:AppData.WorkflowMap.ViewID~}'].addGuardLeaf()">Add condition</button>`
		},
		{
			Hash: 'Workflow-Map-Guard-Raw',
			Template: /*html*/`<div class="wfmap-field"><textarea {~D:AppData.WorkflowMap.DisabledAttr~} oninput="_Pict.views['{~D:AppData.WorkflowMap.ViewID~}'].editGuardRaw(this.value)">{~D:Record.RawText~}</textarea></div>`
		}
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
				Inspector: { EmptySlot: [{ Hint: 'Select a state or a transition to edit it.' }], StateSlot: [], TransitionSlot: [], DeleteSlot: [], GuardLeavesSlot: [], GuardRawSlot: [], GuardAddSlot: [], Guard: { Leaves: [] } },
				OperatorOptions: _OPERATORS.map((pOp) => ({ Value: pOp })),
				LaneOptions: [],
				EntitlementOptions: []
			};
		}
		this.pict.AppData.WorkflowMap.ViewID = this.options.ViewIdentifier;
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
	 * Open a type record (from the catalog) in the map. Built-ins open read-only; owned types
	 * open editable. Pulls the full definition and the saved layout through the client, then
	 * renders the graph.
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
		this._renderInspector();
		this.pict.CSSMap.injectCSS();
		return super.onAfterRender(pRenderable, pRenderDestinationAddress, pRecord, pContent);
	}

	_ensureFlowView()
	{
		let tmpID = this.options.ViewIdentifier;
		let tmpContainer = '#WFMap-Flow-' + tmpID;
		if (!this._FlowView)
		{
			let tmpStateCard = new libStateCard(this.fable, {}, 'Workflow-StateCard');
			let tmpNodeTypes = {}; let tmpConfig = tmpStateCard.getNodeTypeConfiguration(); tmpNodeTypes[tmpConfig.Hash] = tmpConfig;

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
					Renderables: [ { RenderableHash: 'Flow-Container', TemplateHash: 'Flow-Container-Template', DestinationAddress: tmpContainer, RenderMethod: 'replace' } ]
				},
				libPictSectionFlow);
		}
		this._FlowView.initialRenderComplete = false;
		this._FlowView.render();
		this._wireFlowEvents();
	}

	_wireFlowEvents()
	{
		let tmpEvents = this._FlowView._EventHandlerProvider;
		if (!tmpEvents || this._FlowEventsWired) { return; }
		this._FlowEventsWired = true;
		tmpEvents.registerHandler('onNodeSelected', (pNode) => this._onNodeSelected(pNode));
		tmpEvents.registerHandler('onConnectionSelected', (pConnection) => this._onConnectionSelected(pConnection));
		tmpEvents.registerHandler('onFlowChanged', () => this._markDirty());
		tmpEvents.registerHandler('onNodeMoved', () => this._markDirty());
		tmpEvents.registerHandler('onConnectionCreated', () => { this._markDirty(); this._refreshOptionLists(); });
	}

	_loadFlow(pDefinition, pLayout)
	{
		let tmpFlow = libDefinitionFlow.definitionToFlow(pDefinition, pLayout || {});
		this._FlowView.setFlowData({ Nodes: tmpFlow.Nodes, Connections: tmpFlow.Connections });
		this._refreshOptionLists();
		this._clearSelection();
	}

	_applyMode()
	{
		let tmpState = this._state();
		let tmpEditable = (tmpState.Mode === 'edit');
		tmpState.DisabledAttr = tmpEditable ? '' : 'disabled';
		tmpState.ViewSlot = (tmpState.Mode === 'view') ? [{}] : [];
		tmpState.EditSlot = tmpEditable ? [{}] : [];
		// Read-only graphs still pan/zoom and select for reading, but no structural edits.
		if (this._FlowView)
		{
			this._FlowView.options.EnableConnectionCreation = tmpEditable;
			this._FlowView.options.EnableNodeDragging = tmpEditable;
		}
	}

	// -- selection + inspector -------------------------------------------------

	_onNodeSelected(pNode)
	{
		let tmpState = this._state();
		let tmpData = pNode.Data || {};
		tmpState.Inspector.Selection = { Kind: 'state', Hash: pNode.Hash };
		tmpState.Inspector.EmptySlot = [];
		tmpState.Inspector.TransitionSlot = [];
		tmpState.Inspector.GuardLeavesSlot = []; tmpState.Inspector.GuardRawSlot = []; tmpState.Inspector.GuardAddSlot = [];
		tmpState.Inspector.StateSlot =
		[{
			Key: tmpData.Key || '',
			Name: pNode.Title || '',
			Lane: tmpData.Lane || '',
			Marker: tmpData.Marker || '',
			InitialChecked: tmpData.IsInitial ? 'checked' : '',
			TerminalChecked: tmpData.IsTerminal ? 'checked' : ''
		}];
		tmpState.Inspector.DeleteSlot = (tmpState.Mode === 'edit') ? [{}] : [];
		this._renderInspector();
	}

	_onConnectionSelected(pConnection)
	{
		let tmpState = this._state();
		let tmpData = pConnection.Data || {};
		let tmpFromKey = this._keyOfNode(pConnection.SourceNodeHash);
		let tmpToKey = this._keyOfNode(pConnection.TargetNodeHash);
		let tmpGuardModel = _guardToModel(tmpData.Guard);

		tmpState.Inspector.Selection = { Kind: 'transition', Hash: pConnection.Hash };
		tmpState.Inspector.EmptySlot = [];
		tmpState.Inspector.StateSlot = []; tmpState.Inspector.DeleteSlot = [];
		tmpState.Inspector.Guard = tmpGuardModel;
		tmpState.Inspector.TransitionSlot =
		[{
			From: tmpFromKey, To: tmpToKey,
			RequiresEntitlement: tmpData.RequiresEntitlement || '',
			ActorAddress: tmpData.ActorAddress || '',
			GuardModeNone: tmpGuardModel.Mode === 'none' ? 'selected' : '',
			GuardModeAll: tmpGuardModel.Mode === 'all' ? 'selected' : '',
			GuardModeAny: tmpGuardModel.Mode === 'any' ? 'selected' : '',
			GuardModeRaw: tmpGuardModel.Mode === 'raw' ? 'selected' : ''
		}];
		this._applyGuardSlots(tmpGuardModel);
		this._renderInspector();
	}

	_applyGuardSlots(pGuardModel)
	{
		let tmpInspector = this._state().Inspector;
		let tmpStructured = (pGuardModel.Mode === 'all' || pGuardModel.Mode === 'any');
		tmpInspector.GuardLeavesSlot = tmpStructured ? [{}] : [];
		tmpInspector.GuardAddSlot = tmpStructured ? [{}] : [];
		tmpInspector.GuardRawSlot = (pGuardModel.Mode === 'raw') ? [{ RawText: pGuardModel.RawText || '' }] : [];
	}

	_clearSelection()
	{
		let tmpInspector = this._state().Inspector;
		tmpInspector.Selection = null;
		tmpInspector.StateSlot = []; tmpInspector.TransitionSlot = []; tmpInspector.DeleteSlot = [];
		tmpInspector.GuardLeavesSlot = []; tmpInspector.GuardRawSlot = []; tmpInspector.GuardAddSlot = [];
		tmpInspector.EmptySlot = [{ Hint: (this._state().Mode === 'view') ? 'Read-only built-in. Select a state or transition to inspect it, or adopt to edit.' : 'Select a state or a transition to edit it. Drag from a state\'s right port to another\'s left port to add a transition.' }];
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
	_renderInspector() { this._renderRegion('Inspector', 'Workflow-Map-Inspector'); }

	// -- editing a state -------------------------------------------------------

	editState(pField, pValue)
	{
		let tmpSelection = this._selection(); if (!tmpSelection || tmpSelection.Kind !== 'state') { return; }
		let tmpNode = this._FlowView.getNode(tmpSelection.Hash); if (!tmpNode) { return; }
		if (pField === 'Name') { tmpNode.Title = pValue; }
		else if (pField === 'IsInitial' || pField === 'IsTerminal') { if (pValue) { tmpNode.Data[pField] = true; } else { delete tmpNode.Data[pField]; } }
		else { if (pValue) { tmpNode.Data[pField] = pValue; } else { delete tmpNode.Data[pField]; } }
		if (pField === 'Lane') { this._recolorLanes(); this._refreshOptionLists(); }
		this._markDirty();
		this._FlowView.renderFlow();
	}

	deleteSelected()
	{
		let tmpSelection = this._selection(); if (!tmpSelection) { return; }
		if (tmpSelection.Kind === 'state') { this._FlowView.removeNode(tmpSelection.Hash); }
		this._clearSelection();
		this._refreshOptionLists();
		this._markDirty();
		this._renderInspector();
	}

	// -- editing a transition --------------------------------------------------

	editTransition(pField, pValue)
	{
		let tmpConnection = this._selectedConnection(); if (!tmpConnection) { return; }
		if (pValue) { tmpConnection.Data[pField] = pValue; } else { delete tmpConnection.Data[pField]; }
		if (pField === 'RequiresEntitlement') { this._refreshOptionLists(); }
		this._markDirty();
	}

	setGuardMode(pMode)
	{
		let tmpInspector = this._state().Inspector;
		let tmpGuard = tmpInspector.Guard || { Mode: 'none', Leaves: [] };
		tmpGuard.Mode = pMode;
		if ((pMode === 'all' || pMode === 'any') && !Array.isArray(tmpGuard.Leaves)) { tmpGuard.Leaves = []; }
		tmpInspector.Guard = tmpGuard;
		this._applyGuardSlots(tmpGuard);
		this._writeGuard();
		// Keep the mode dropdown selection in sync for the next render.
		let tmpTransitionSlot = tmpInspector.TransitionSlot[0];
		if (tmpTransitionSlot)
		{
			tmpTransitionSlot.GuardModeNone = pMode === 'none' ? 'selected' : '';
			tmpTransitionSlot.GuardModeAll = pMode === 'all' ? 'selected' : '';
			tmpTransitionSlot.GuardModeAny = pMode === 'any' ? 'selected' : '';
			tmpTransitionSlot.GuardModeRaw = pMode === 'raw' ? 'selected' : '';
		}
		this._renderInspector();
	}

	addGuardLeaf()
	{
		let tmpGuard = this._state().Inspector.Guard; if (!tmpGuard) { return; }
		tmpGuard.Leaves = tmpGuard.Leaves || [];
		tmpGuard.Leaves.push({ Address: '', Op: 'truthy', Value: '', Index: tmpGuard.Leaves.length });
		this._reindexLeaves();
		this._writeGuard();
		this._renderInspector();
	}

	removeGuardLeaf(pIndex)
	{
		let tmpGuard = this._state().Inspector.Guard; if (!tmpGuard || !tmpGuard.Leaves) { return; }
		tmpGuard.Leaves.splice(pIndex, 1);
		this._reindexLeaves();
		this._writeGuard();
		this._renderInspector();
	}

	editGuardLeaf(pIndex, pField, pValue)
	{
		let tmpGuard = this._state().Inspector.Guard; if (!tmpGuard || !tmpGuard.Leaves || !tmpGuard.Leaves[pIndex]) { return; }
		tmpGuard.Leaves[pIndex][pField] = pValue;
		this._writeGuard();
	}

	editGuardRaw(pValue)
	{
		let tmpGuard = this._state().Inspector.Guard; if (!tmpGuard) { return; }
		tmpGuard.RawText = pValue;
		this._writeGuard();
	}

	_reindexLeaves()
	{
		let tmpGuard = this._state().Inspector.Guard;
		if (tmpGuard && tmpGuard.Leaves) { tmpGuard.Leaves.forEach((pLeaf, pIndex) => { pLeaf.Index = pIndex; }); }
	}

	// Build the guard object from the editor model and write it onto the selected connection.
	_writeGuard()
	{
		let tmpConnection = this._selectedConnection(); if (!tmpConnection) { return; }
		let tmpGuard = _modelToGuard(this._state().Inspector.Guard);
		if (tmpGuard == null) { delete tmpConnection.Data.Guard; }
		else { tmpConnection.Data.Guard = tmpGuard; }
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

	autoArrange()
	{
		if (!this._FlowView) { return; }
		this._FlowView.autoLayout();
		this._markDirty();
	}

	saveCurrentLayout()
	{
		let tmpClient = this._client(); let tmpRecord = this._state().TypeRecord;
		if (!tmpClient || !tmpClient.saveLayout || !tmpRecord) { return; }
		let tmpLayout = this._collectLayout();
		tmpClient.saveLayout(tmpRecord.ID, tmpLayout).then(() =>
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

	_selection() { return this._state().Inspector.Selection; }
	_selectedConnection() { let tmpSelection = this._selection(); return (tmpSelection && tmpSelection.Kind === 'transition') ? this._FlowView.getConnection(tmpSelection.Hash) : null; }
	_keyOfNode(pNodeHash) { let tmpNode = this._FlowView.getNode(pNodeHash); return (tmpNode && tmpNode.Data && tmpNode.Data.Key) || (tmpNode && tmpNode.Title) || '?'; }

	_currentDefinition()
	{
		let tmpFlow = this._FlowView.getFlowData();
		return libDefinitionFlow.flowToDefinition(tmpFlow, this._Meta);
	}

	_collectLayout()
	{
		let tmpFlow = this._FlowView.getFlowData();
		let tmpLayout = {};
		(tmpFlow.Nodes || []).forEach((pNode) =>
		{
			let tmpKey = (pNode.Data && pNode.Data.Key) || pNode.Hash;
			tmpLayout[tmpKey] = { X: pNode.X, Y: pNode.Y };
		});
		return tmpLayout;
	}

	// After a lane edit, recolor every node so a lane keeps one consistent color.
	_recolorLanes()
	{
		let tmpDefinition = this._currentDefinition();
		let tmpColors = libDefinitionFlow.laneColors(tmpDefinition);
		(this._FlowView.flowData.Nodes || []).forEach((pNode) =>
		{
			let tmpLane = (pNode.Data && pNode.Data.Lane) || (pNode.Data && pNode.Data.Key) || pNode.Hash;
			if (tmpColors[tmpLane]) { pNode.TitleBarColor = tmpColors[tmpLane]; }
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

	_markDirty() { this._state().Dirty = true; }

	_toast(pMessage, pType)
	{
		let tmpModal = this._modal();
		if (tmpModal && typeof tmpModal.toast === 'function') { tmpModal.toast(pMessage, { type: pType || 'info' }); }
	}
}

// Parse a guard tree into the editor model. Simple all/any of leaves edit structurally; anything
// else (a bare leaf, a not, nesting) drops to a raw JSON editor so no shape is lost.
function _guardToModel(pGuard)
{
	if (pGuard == null) { return { Mode: 'none', Leaves: [] }; }
	let tmpBranch = Array.isArray(pGuard.all) ? 'all' : (Array.isArray(pGuard.any) ? 'any' : null);
	if (tmpBranch)
	{
		let tmpChildren = pGuard[tmpBranch];
		let tmpAllLeaves = tmpChildren.every((pChild) => pChild && pChild.address && !pChild.all && !pChild.any && !pChild.not);
		if (tmpAllLeaves)
		{
			return { Mode: tmpBranch, Leaves: tmpChildren.map((pChild, pIndex) => ({ Address: pChild.address, Op: pChild.op || 'truthy', Value: _valueToText(pChild.value), Index: pIndex })) };
		}
	}
	return { Mode: 'raw', Leaves: [], RawText: JSON.stringify(pGuard, null, 2) };
}

// Build a guard tree from the editor model. 'none' -> null; all/any -> { all|any: [leaves] };
// raw -> parsed JSON (or null when the text is blank or not yet valid JSON).
function _modelToGuard(pModel)
{
	if (!pModel || pModel.Mode === 'none') { return null; }
	if (pModel.Mode === 'raw')
	{
		let tmpText = (pModel.RawText || '').trim();
		if (!tmpText) { return null; }
		try { return JSON.parse(tmpText); } catch (pError) { return { _invalid: tmpText }; }
	}
	let tmpLeaves = (pModel.Leaves || []).filter((pLeaf) => pLeaf.Address).map((pLeaf) =>
	{
		let tmpLeaf = { address: pLeaf.Address, op: pLeaf.Op || 'truthy' };
		if (pLeaf.Value !== '' && pLeaf.Value != null) { tmpLeaf.value = _textToValue(pLeaf.Value); }
		return tmpLeaf;
	});
	if (!tmpLeaves.length) { return null; }
	let tmpGuard = {}; tmpGuard[pModel.Mode] = tmpLeaves; return tmpGuard;
}

// Guard values may be strings, numbers, booleans, or arrays. Show them so a person can edit them,
// and read them back with their type intact (JSON when it parses, otherwise the raw string).
function _valueToText(pValue) { if (pValue === undefined) { return ''; } return (typeof pValue === 'string') ? pValue : JSON.stringify(pValue); }
function _textToValue(pText) { try { return JSON.parse(pText); } catch (pError) { return pText; } }

module.exports = PictViewWorkflowMap;
module.exports.default_configuration = _ViewConfiguration;
