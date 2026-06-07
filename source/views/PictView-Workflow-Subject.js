'use strict';

/**
 * Subject detail: timeline, metrics, agency for one subject.
 *
 * Timeline is the event log as a vertical history (opened, entered and left states, actor start
 * and stop, became-available, closed), each row with its actor and time. Metrics are the folded
 * rollup as figures plus a per-state breakdown. Agency is who can act now: the open exits and the
 * entitlement each needs. Everything comes from the injected client; state names come from the
 * type's definition so the rows read in plain words, not state keys.
 *
 * @author Steven Velozo <steven@velozo.com>
 * @license MIT
 */

const libPictView = require('pict-view');
const libMetricsFormat = require('../Metrics-Format.js');

const _EVENT_LABELS =
{
	opened: 'Opened',
	closed: 'Closed',
	'actor.start': 'Work started',
	'actor.stop': 'Work paused',
	'exit.became-available': 'Became available'
};

const _ViewConfiguration =
{
	ViewIdentifier: 'Workflow-Subject',
	DefaultRenderable: 'Workflow-Subject-Container',
	DefaultDestinationAddress: '#Workflow-Subject-Container',
	AutoRender: false,

	ClientProvider: 'WorkflowAPI',
	Client: null,

	CSS: /*css*/`
		.wfs { display: flex; flex-direction: column; gap: 0.9em; padding: 0.25em; }
		.wfs-head { display: flex; align-items: center; justify-content: space-between; }
		.wfs-title { font-size: 1.15em; font-weight: 600; margin: 0; }
		.wfs-state { font-size: 0.85em; color: var(--theme-color-text-secondary, #777); }
		.wfs-cols { display: flex; gap: 1em; flex-wrap: wrap; }
		.wfs-col { flex: 1; min-width: 240px; }
		.wfs-col h3 { font-size: 0.95em; margin: 0 0 0.5em; border-bottom: 1px solid var(--theme-color-border-light, #eee); padding-bottom: 0.3em; }
		.wfs-figures { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5em; }
		.wfs-figure { background: var(--theme-color-background-tertiary, #f5f5f5); border-radius: 5px; padding: 0.5em 0.6em; }
		.wfs-figure-label { font-size: 0.72em; text-transform: uppercase; letter-spacing: 0.03em; color: var(--theme-color-text-secondary, #888); }
		.wfs-figure-value { font-size: 1.05em; font-weight: 600; }
		.wfs-bar-row { margin-bottom: 0.4em; }
		.wfs-bar-label { display: flex; justify-content: space-between; font-size: 0.8em; margin-bottom: 0.15em; }
		.wfs-bar-track { background: var(--theme-color-background-tertiary, #eee); border-radius: 3px; height: 8px; overflow: hidden; }
		.wfs-bar-fill { background: var(--theme-color-brand-primary, #2e7d74); height: 100%; }
		.wfs-timeline { list-style: none; margin: 0; padding: 0; }
		.wfs-event { display: flex; gap: 0.5em; padding: 0.35em 0; border-bottom: 1px solid var(--theme-color-border-light, #f0f0f0); font-size: 0.85em; }
		.wfs-event-when { color: var(--theme-color-text-secondary, #999); flex-shrink: 0; width: 130px; font-variant-numeric: tabular-nums; }
		.wfs-event-what { flex: 1; }
		.wfs-event-actor { color: var(--theme-color-text-secondary, #888); }
		.wfs-agency-row { padding: 0.4em 0; font-size: 0.88em; border-bottom: 1px solid var(--theme-color-border-light, #f0f0f0); }
		.wfs-agency-ent { color: var(--theme-color-text-secondary, #888); font-size: 0.82em; }
		.wfs-empty { color: var(--theme-color-text-secondary, #999); font-size: 0.85em; }
	`,

	Templates:
	[
		{
			Hash: 'Workflow-Subject-Container',
			Template: /*html*/`
<div class="wfs">
	<div class="wfs-head">
		<h2 class="wfs-title">{~D:AppData.WorkflowSubject.Title~}</h2>
		<span class="wfs-state">{~D:AppData.WorkflowSubject.StateText~}</span>
	</div>
	<div class="wfs-cols">
		<div class="wfs-col">
			<h3>Metrics</h3>
			<div class="wfs-figures">{~TS:Workflow-Subject-Figure:AppData.WorkflowSubject.Figures~}</div>
			<div style="margin-top:0.7em">{~TS:Workflow-Subject-Bar:AppData.WorkflowSubject.StateTime~}</div>
		</div>
		<div class="wfs-col">
			<h3>Who can act now</h3>
			{~TS:Workflow-Subject-Agency:AppData.WorkflowSubject.Agency~}
			{~TS:Workflow-Subject-AgencyEmpty:AppData.WorkflowSubject.AgencyEmptySlot~}
		</div>
	</div>
	<div class="wfs-col">
		<h3>Timeline</h3>
		<ul class="wfs-timeline">{~TS:Workflow-Subject-Event:AppData.WorkflowSubject.Timeline~}</ul>
		{~TS:Workflow-Subject-TimelineEmpty:AppData.WorkflowSubject.TimelineEmptySlot~}
	</div>
</div>`
		},
		{ Hash: 'Workflow-Subject-Figure', Template: /*html*/`<div class="wfs-figure"><div class="wfs-figure-label">{~D:Record.Label~}</div><div class="wfs-figure-value">{~D:Record.Value~}</div></div>` },
		{ Hash: 'Workflow-Subject-Bar', Template: /*html*/`<div class="wfs-bar-row"><div class="wfs-bar-label"><span>{~D:Record.State~}</span><span>{~D:Record.Value~}</span></div><div class="wfs-bar-track"><div class="wfs-bar-fill" style="width:{~D:Record.Percent~}%"></div></div></div>` },
		{ Hash: 'Workflow-Subject-Agency', Template: /*html*/`<div class="wfs-agency-row"><div>Move to <strong>{~D:Record.ToName~}</strong></div><div class="wfs-agency-ent">{~D:Record.EntitlementText~}</div></div>` },
		{ Hash: 'Workflow-Subject-AgencyEmpty', Template: /*html*/`<div class="wfs-empty">No moves are available right now.</div>` },
		{ Hash: 'Workflow-Subject-Event', Template: /*html*/`<li class="wfs-event"><span class="wfs-event-when">{~D:Record.When~}</span><span class="wfs-event-what">{~D:Record.What~} <span class="wfs-event-actor">{~D:Record.ActorText~}</span></span></li>` },
		{ Hash: 'Workflow-Subject-TimelineEmpty', Template: /*html*/`<div class="wfs-empty">This subject has not been opened in the workflow yet.</div>` }
	],

	Renderables:
	[
		{ RenderableHash: 'Workflow-Subject-Container', TemplateHash: 'Workflow-Subject-Container', DestinationAddress: '#Workflow-Subject-Container', RenderMethod: 'replace' }
	]
};

class PictViewWorkflowSubject extends libPictView
{
	onBeforeInitialize()
	{
		if (!this.pict.AppData.WorkflowSubject)
		{
			this.pict.AppData.WorkflowSubject = { ViewID: this.options.ViewIdentifier, SubjectID: null, Title: 'Subject', StateText: '', Figures: [], StateTime: [], Agency: [], AgencyEmptySlot: [], Timeline: [], TimelineEmptySlot: [] };
		}
		this.pict.AppData.WorkflowSubject.ViewID = this.options.ViewIdentifier;
		return super.onBeforeInitialize();
	}

	_state() { return this.pict.AppData.WorkflowSubject; }
	_client() { if (this.options.Client) { return this.options.Client; } let tmpName = this.options.ClientProvider || 'WorkflowAPI'; return (this.pict.providers && this.pict.providers[tmpName]) || null; }

	/**
	 * Load and show one subject. pTypeRecord (optional) supplies the definition so state keys
	 * render as their names; pTitle (optional) is the subject's display title.
	 */
	showSubject(pSubjectID, pTypeRecord, pTitle)
	{
		let tmpState = this._state();
		let tmpClient = this._client();
		tmpState.SubjectID = pSubjectID;
		tmpState.Title = pTitle || ('Work item #' + pSubjectID);
		this._StateNames = this._buildStateNames(pTypeRecord);
		if (!tmpClient) { this.render(); return Promise.resolve(); }

		return Promise.all(
			[
				tmpClient.getSubject(pSubjectID).catch(() => null),
				tmpClient.getTimeline(pSubjectID).catch(() => []),
				tmpClient.getMetrics(pSubjectID).catch(() => null),
				tmpClient.getAgency(pSubjectID).catch(() => [])
			]).then((pResults) =>
		{
			this._applySubject(pResults[0]);
			this._applyTimeline(pResults[1]);
			this._applyMetrics(pResults[2]);
			this._applyAgency(pResults[3]);
			this.render();
		});
	}

	_buildStateNames(pTypeRecord)
	{
		let tmpNames = {};
		let tmpDefinition = pTypeRecord && pTypeRecord.WorkflowDefinition;
		((tmpDefinition && tmpDefinition.States) || []).forEach((pState) => { tmpNames[pState.Key] = pState.Name || pState.Key; });
		return tmpNames;
	}

	_stateName(pKey) { return (this._StateNames && this._StateNames[pKey]) || pKey; }

	_applySubject(pSubject)
	{
		let tmpState = this._state();
		if (!pSubject || !pSubject.State) { tmpState.StateText = ''; return; }
		let tmpCurrent = (pSubject.State.CurrentStates || []).map((pKey) => this._stateName(pKey)).join(', ');
		tmpState.StateText = pSubject.State.Closed ? 'Closed' : ('In ' + (tmpCurrent || 'an unknown state'));
	}

	_applyTimeline(pEvents)
	{
		let tmpState = this._state();
		let tmpRows = (pEvents || []).slice().sort((pA, pB) => ((pA.At || 0) - (pB.At || 0)) || ((pA.ID || 0) - (pB.ID || 0)));
		tmpState.Timeline = tmpRows.map((pEvent) => ({ When: _formatWhen(pEvent.At), What: this._eventLabel(pEvent), ActorText: pEvent.Actor ? ('by ' + pEvent.Actor) : '' }));
		tmpState.TimelineEmptySlot = tmpState.Timeline.length ? [] : [{}];
	}

	_eventLabel(pEvent)
	{
		if (pEvent.Type === 'state.enter') { return 'Entered ' + this._stateName(pEvent.State); }
		if (pEvent.Type === 'state.exit') { return 'Left ' + this._stateName(pEvent.State); }
		if (pEvent.Type === 'exit.became-available') { return 'Became ready to move to ' + this._stateName(pEvent.Payload && pEvent.Payload.ToState); }
		return _EVENT_LABELS[pEvent.Type] || pEvent.Type;
	}

	_applyMetrics(pMetrics)
	{
		let tmpState = this._state();
		let tmpSummary = libMetricsFormat.summarizeMetrics(pMetrics, this._StateNames || {});
		tmpState.Figures = tmpSummary.Figures;
		let tmpMax = tmpSummary.StateTime.reduce((pAccumulator, pRow) => Math.max(pAccumulator, pRow.RawMS), 0) || 1;
		tmpState.StateTime = tmpSummary.StateTime.map((pRow) => ({ State: pRow.State, Value: pRow.Value, Percent: Math.round((pRow.RawMS / tmpMax) * 100) }));
	}

	_applyAgency(pAgency)
	{
		let tmpState = this._state();
		tmpState.Agency = (pAgency || []).map((pExit) => (
			{
				ToName: this._stateName(pExit.ToState),
				EntitlementText: pExit.RequiredEntitlement ? ('requires ' + pExit.RequiredEntitlement) : 'no entitlement required'
			}));
		tmpState.AgencyEmptySlot = tmpState.Agency.length ? [] : [{}];
	}

	onAfterRender(pRenderable, pRenderDestinationAddress, pRecord, pContent)
	{
		this.pict.CSSMap.injectCSS();
		return super.onAfterRender(pRenderable, pRenderDestinationAddress, pRecord, pContent);
	}
}

function _formatWhen(pMilliseconds)
{
	let tmpMS = Number(pMilliseconds);
	if (!isFinite(tmpMS) || tmpMS <= 0) { return ''; }
	try { return new Date(tmpMS).toLocaleString(); } catch (pError) { return String(tmpMS); }
}

module.exports = PictViewWorkflowSubject;
module.exports.default_configuration = _ViewConfiguration;
