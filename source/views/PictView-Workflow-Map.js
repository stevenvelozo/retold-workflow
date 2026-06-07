'use strict';

/**
 * Workflow map / designer.
 *
 * The centerpiece: a workflow definition rendered as a node-and-edge graph on pict-section-flow.
 * States are nodes (a StateCard, colored by lane), transitions are connections. Editing happens on
 * the graph: double-click a state to open its properties panel (Name, Lane, Marker, IsInitial,
 * IsTerminal); double-click a transition to open its panel (RequiresEntitlement, ActorAddress, and
 * a structured Guard as JSON). Both are pict-section-flow on-graph panels; the transition panel is
 * a connection (edge) panel, the feature pict-section-flow gained for this. The graph is the
 * definition: reading it back (flowToDefinition) takes From and To from the wires.
 *
 * Built-in (platform) types open read-only; the first move to edit one offers to adopt it (clone
 * into the tenant) and edits the clone. Before a save, the assembled definition runs through the
 * engine's own defineWorkflow checks, and a failure is shown rather than persisted. Node positions
 * save and restore as a per-type layout through the client; positions are not part of the
 * definition.
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
<button class="wfmap-btn" onclick="_Pict.views['{~D:AppData.WorkflowMap.ViewID~}'].autoArrange()">Auto-arrange</button>
<span class="wfmap-hint">Double-click a state or transition to inspect it.</span>`
		},
		{
			Hash: 'Workflow-Map-Toolbar-Edit',
			Template: /*html*/`
<button class="wfmap-btn" onclick="_Pict.views['{~D:AppData.WorkflowMap.ViewID~}'].addState()">Add state</button>
<button class="wfmap-btn" onclick="_Pict.views['{~D:AppData.WorkflowMap.ViewID~}'].deleteSelected()">Delete selected</button>
<button class="wfmap-btn" onclick="_Pict.views['{~D:AppData.WorkflowMap.ViewID~}'].autoArrange()">Auto-arrange</button>
<button class="wfmap-btn" onclick="_Pict.views['{~D:AppData.WorkflowMap.ViewID~}'].saveCurrentLayout()">Save layout</button>
<button class="wfmap-btn wfmap-btn-primary" onclick="_Pict.views['{~D:AppData.WorkflowMap.ViewID~}'].save()">Save workflow</button>
<span class="wfmap-hint">Double-click a state or transition to edit it. Drag a state's right port to another's left port to add a transition.</span>`
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

// The on-graph editor for a transition (a connection / edge panel). Registered on the embedded
// flow view as its ConnectionPropertiesPanel; the inputs call back into this map view by hash.
const _TRANSITION_PANEL =
{
	PanelType: 'Template',
	DefaultWidth: 300,
	DefaultHeight: 280,
	Title: 'Transition',
	Configuration:
	{
		TemplateHash: 'Workflow-Transition-Panel',
		Templates:
		[
			{
				Hash: 'Workflow-Transition-Panel',
				Template: /*html*/`
<div class="wfp">
	<div class="wfp-transition-head">{~D:Record.Data._FromName~} to {~D:Record.Data._ToName~}</div>
	<div class="wfp-field"><label class="wfp-label">Requires entitlement</label><input type="text" class="wfp-input" list="WFMap-Entitlements" value="{~D:Record.Data.RequiresEntitlement~}" {~D:AppData.WorkflowMap.DisabledAttr~} oninput="_Pict.views['{~D:AppData.WorkflowMap.ViewID~}'].editTransition('{~D:Record.Hash~}','RequiresEntitlement',this.value)"></div>
	<div class="wfp-field"><label class="wfp-label">Actor address</label><input type="text" class="wfp-input" value="{~D:Record.Data.ActorAddress~}" {~D:AppData.WorkflowMap.DisabledAttr~} oninput="_Pict.views['{~D:AppData.WorkflowMap.ViewID~}'].editTransition('{~D:Record.Hash~}','ActorAddress',this.value)"></div>
	<div class="wfp-field"><label class="wfp-label">Guard (JSON, blank for none)</label><textarea class="wfp-input wfp-textarea" {~D:AppData.WorkflowMap.DisabledAttr~} oninput="_Pict.views['{~D:AppData.WorkflowMap.ViewID~}'].editTransitionGuard('{~D:Record.Hash~}',this.value)">{~D:Record.Data._GuardText~}</textarea></div>
</div>`
			}
		]
	}
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
					ConnectionPropertiesPanel: _TRANSITION_PANEL,
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
		tmpEvents.registerHandler('onFlowChanged', () => this._markDirty());
		tmpEvents.registerHandler('onNodeMoved', () => this._markDirty());
		tmpEvents.registerHandler('onConnectionCreated', () => { this._markDirty(); this._stampConnectionDisplayFields(); this._refreshOptionLists(); });
		// A panel edits the underlying node/connection live; on close, repaint so a renamed or
		// re-laned state shows its new title and color, and refresh the autocomplete lists.
		tmpEvents.registerHandler('onPanelClosed', () => this._afterPanelEdit());
	}

	_loadFlow(pDefinition, pLayout)
	{
		let tmpFlow = libDefinitionFlow.definitionToFlow(pDefinition, pLayout || {});
		this._FlowView.setFlowData({ Nodes: tmpFlow.Nodes, Connections: tmpFlow.Connections });
		this._stampConnectionDisplayFields();
		this._refreshOptionLists();
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

	// -- editing (called from the on-graph panels, by hash) --------------------

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
		let tmpConnection = this._FlowView.getConnection(pHash); if (!tmpConnection) { return; }
		if (pValue) { tmpConnection.Data[pField] = pValue; } else { delete tmpConnection.Data[pField]; }
		this._markDirty();
	}

	editTransitionGuard(pHash, pValue)
	{
		if (this._state().Mode !== 'edit') { return; }
		let tmpConnection = this._FlowView.getConnection(pHash); if (!tmpConnection) { return; }
		tmpConnection.Data._GuardText = pValue;
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

	deleteSelected()
	{
		if (this._state().Mode !== 'edit') { return; }
		this._FlowView.deleteSelected();
		this._stampConnectionDisplayFields();
		this._refreshOptionLists();
		this._markDirty();
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
		// structured Data.Guard before reading the definition. Invalid JSON becomes a guard the
		// engine rejects, so the save surfaces a clear error rather than silently dropping it.
		(tmpFlow.Connections || []).forEach((pConnection) =>
		{
			let tmpData = pConnection.Data || {};
			if (Object.prototype.hasOwnProperty.call(tmpData, '_GuardText'))
			{
				let tmpText = String(tmpData._GuardText || '').trim();
				if (!tmpText) { delete tmpData.Guard; }
				else { try { tmpData.Guard = JSON.parse(tmpText); } catch (pError) { tmpData.Guard = { _invalid: tmpText }; } }
			}
		});
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

	// Repaint after a panel closes: recolor lanes (a state may have changed lane), re-render the
	// graph (titles/colors), refresh autocomplete, and mark dirty.
	_afterPanelEdit()
	{
		this._recolorLanes();
		this._stampConnectionDisplayFields();
		this._refreshOptionLists();
		if (this._FlowView) { this._FlowView.renderFlow(); }
		this._markDirty();
	}

	// After a lane edit, recolor every node so a lane keeps one consistent color.
	_recolorLanes()
	{
		if (!this._FlowView) { return; }
		let tmpDefinition = this._currentDefinition();
		let tmpColors = libDefinitionFlow.laneColors(tmpDefinition);
		(this._FlowView.flowData.Nodes || []).forEach((pNode) =>
		{
			let tmpLane = (pNode.Data && pNode.Data.Lane) || (pNode.Data && pNode.Data.Key) || pNode.Hash;
			if (tmpColors[tmpLane]) { pNode.TitleBarColor = tmpColors[tmpLane]; }
		});
	}

	// Stamp transient display fields onto each connection so the transition panel can show the
	// From/To names and the guard as JSON. flowToDefinition ignores these (it reads From/To from
	// the wires and the guard from Data.Guard), so they never reach the saved definition.
	_stampConnectionDisplayFields()
	{
		if (!this._FlowView) { return; }
		let tmpNameByHash = {};
		(this._FlowView.flowData.Nodes || []).forEach((pNode) => { tmpNameByHash[pNode.Hash] = pNode.Title || ((pNode.Data && pNode.Data.Key) || pNode.Hash); });
		(this._FlowView.flowData.Connections || []).forEach((pConnection) =>
		{
			if (!pConnection.Data) { pConnection.Data = {}; }
			pConnection.Data._FromName = tmpNameByHash[pConnection.SourceNodeHash] || '?';
			pConnection.Data._ToName = tmpNameByHash[pConnection.TargetNodeHash] || '?';
			if (!Object.prototype.hasOwnProperty.call(pConnection.Data, '_GuardText'))
			{
				pConnection.Data._GuardText = pConnection.Data.Guard ? JSON.stringify(pConnection.Data.Guard, null, 2) : '';
			}
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
