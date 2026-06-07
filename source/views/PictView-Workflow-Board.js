'use strict';

/**
 * Workflow board (run time).
 *
 * The lanes a person works in, with each subject sitting in the lane of its current state. Built
 * on the board model in the core: state-to-lane is many-to-one, so two states in one lane keep a
 * card in place and only change its marker. A card's "Move" opens a menu of the transitions out
 * of its current state; choosing one calls advance through the client. A move the gates refuse
 * comes back with a reason, shown in a modal rather than a native alert.
 *
 * The subjects and the definition (for the lanes) come from the injected client: getBoard(typeID)
 * for the cards, and the type's WorkflowDefinition for the lane layout.
 *
 * @author Steven Velozo <steven@velozo.com>
 * @license MIT
 */

const libPictView = require('pict-view');
const libBoardModel = require('../Board-Model.js');

const _ViewConfiguration =
{
	ViewIdentifier: 'Workflow-Board',
	DefaultRenderable: 'Workflow-Board-Container',
	DefaultDestinationAddress: '#Workflow-Board-Container',
	AutoRender: false,

	ClientProvider: 'WorkflowAPI',
	Client: null,

	CSS: /*css*/`
		.wfb { display: flex; flex-direction: column; flex: 1; min-height: 0; height: 100%; }
		.wfb-head { flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; padding: 0.5em 0.25em 0.6em; }
		.wfb-title { font-size: 1.2em; font-weight: 600; margin: 0; }
		.wfb-lanes { display: flex; gap: 0.6em; flex: 1; min-height: 0; overflow-x: auto; padding-bottom: 0.5em; }
		.wfb-lane { flex: 0 0 220px; display: flex; flex-direction: column; background: var(--theme-color-background-tertiary, #f4f4f4); border-radius: 7px; max-height: 100%; }
		.wfb-lane-head { flex-shrink: 0; padding: 0.55em 0.7em; font-weight: 600; font-size: 0.9em; border-bottom: 1px solid var(--theme-color-border-light, #e0e0e0); display: flex; justify-content: space-between; align-items: center; }
		.wfb-lane-count { font-weight: 400; color: var(--theme-color-text-secondary, #888); font-size: 0.85em; }
		.wfb-lane-cards { padding: 0.5em; overflow-y: auto; display: flex; flex-direction: column; gap: 0.5em; }
		.wfb-card { background: var(--theme-color-background-panel, #fff); border: 1px solid var(--theme-color-border-default, #ddd); border-radius: 6px; padding: 0.55em 0.65em; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
		.wfb-card-title { font-size: 0.92em; font-weight: 500; margin-bottom: 0.3em; }
		.wfb-card-marker { font-size: 0.72em; color: var(--theme-color-text-secondary, #777); margin-bottom: 0.4em; }
		.wfb-card-actions { display: flex; gap: 0.35em; }
		.wfb-card-btn { font-size: 0.78em; padding: 0.25em 0.55em; border: 1px solid var(--theme-color-border-default, #ccc); border-radius: 4px; background: var(--theme-color-background-panel, #fff); cursor: pointer; }
		.wfb-card-btn:hover { background: var(--theme-color-background-hover, #f0f0f0); }
		.wfb-empty { color: var(--theme-color-text-secondary, #999); font-size: 0.85em; padding: 0.5em; }
		.wfb-loading { color: var(--theme-color-text-secondary, #888); padding: 1em; }
	`,

	Templates:
	[
		{
			Hash: 'Workflow-Board-Container',
			Template: /*html*/`
<div class="wfb">
	<div class="wfb-head">
		<h2 class="wfb-title">{~D:AppData.WorkflowBoard.TypeName~} board</h2>
	</div>
	{~TS:Workflow-Board-Loading:AppData.WorkflowBoard.LoadingSlot~}
	<div class="wfb-lanes">{~TS:Workflow-Board-Lane:AppData.WorkflowBoard.Lanes~}</div>
</div>`
		},
		{ Hash: 'Workflow-Board-Loading', Template: /*html*/`<div class="wfb-loading">Loading the board...</div>` },
		{
			Hash: 'Workflow-Board-Lane',
			Template: /*html*/`
<div class="wfb-lane">
	<div class="wfb-lane-head"><span>{~D:Record.Lane~}</span><span class="wfb-lane-count">{~D:Record.Count~}</span></div>
	<div class="wfb-lane-cards">
		{~TS:Workflow-Board-Card:Record.Cards~}
		{~TS:Workflow-Board-Lane-Empty:Record.EmptySlot~}
	</div>
</div>`
		},
		{ Hash: 'Workflow-Board-Lane-Empty', Template: /*html*/`<div class="wfb-empty">No cards.</div>` },
		{
			Hash: 'Workflow-Board-Card',
			Template: /*html*/`
<div class="wfb-card">
	<div class="wfb-card-title">{~D:Record.Title~}</div>
	<div class="wfb-card-marker">{~D:Record.Marker~}</div>
	<div class="wfb-card-actions">
		<button class="wfb-card-btn" onclick="_Pict.views['{~D:AppData.WorkflowBoard.ViewID~}'].moveCard({~D:Record.SubjectID~})">Move</button>
		<button class="wfb-card-btn" onclick="_Pict.views['{~D:AppData.WorkflowBoard.ViewID~}'].openSubject({~D:Record.SubjectID~})">Details</button>
	</div>
</div>`
		}
	],

	Renderables:
	[
		{ RenderableHash: 'Workflow-Board-Container', TemplateHash: 'Workflow-Board-Container', DestinationAddress: '#Workflow-Board-Container', RenderMethod: 'replace' }
	]
};

class PictViewWorkflowBoard extends libPictView
{
	onBeforeInitialize()
	{
		if (!this.pict.AppData.WorkflowBoard)
		{
			this.pict.AppData.WorkflowBoard = { ViewID: this.options.ViewIdentifier, TypeRecord: null, TypeName: 'Workflow', Lanes: [], Unassigned: [], LoadingSlot: [] };
		}
		this.pict.AppData.WorkflowBoard.ViewID = this.options.ViewIdentifier;
		return super.onBeforeInitialize();
	}

	_state() { return this.pict.AppData.WorkflowBoard; }
	_client() { if (this.options.Client) { return this.options.Client; } let tmpName = this.options.ClientProvider || 'WorkflowAPI'; return (this.pict.providers && this.pict.providers[tmpName]) || null; }
	_modal() { return this.pict.views['Pict-Section-Modal'] || null; }

	/** Load and show the board for a type record (from the catalog). */
	showType(pTypeRecord)
	{
		let tmpState = this._state();
		tmpState.TypeRecord = pTypeRecord || null;
		tmpState.TypeName = (pTypeRecord && pTypeRecord.Name) || 'Workflow';
		return this.reload();
	}

	reload()
	{
		let tmpState = this._state();
		let tmpClient = this._client();
		let tmpRecord = tmpState.TypeRecord;
		if (!tmpClient || !tmpRecord) { this.render(); return Promise.resolve(); }

		tmpState.LoadingSlot = [{}];
		this.render();

		let tmpDefinitionPromise = tmpRecord.WorkflowDefinition ? Promise.resolve(tmpRecord.WorkflowDefinition)
			: (tmpClient.getType ? tmpClient.getType(tmpRecord.ID).then((pType) => (pType && pType.WorkflowDefinition) || null) : Promise.resolve(null));

		return Promise.all([tmpDefinitionPromise, tmpClient.getBoard(tmpRecord.ID)]).then((pResults) =>
		{
			this._Definition = pResults[0] || { States: [], Transitions: [] };
			let tmpSubjects = pResults[1] || [];
			let tmpModel = libBoardModel.buildBoardModel(this._Definition, tmpSubjects.map((pSubject) => ({ ID: pSubject.ID, State: pSubject.State, Title: pSubject.Title })));
			tmpState.Lanes = tmpModel.Lanes.map((pLane) => this._decorateLane(pLane));
			tmpState.Unassigned = tmpModel.Unassigned;
			tmpState.LoadingSlot = [];
			this.render();
		}).catch((pError) =>
		{
			tmpState.LoadingSlot = [];
			this._toast('Could not load the board: ' + pError.message, 'error');
			this.render();
		});
	}

	_decorateLane(pLane)
	{
		return {
			Lane: pLane.Lane,
			Count: pLane.Cards.length,
			Cards: pLane.Cards.map((pCard) => ({ SubjectID: pCard.SubjectID, Title: pCard.Title || ('#' + pCard.SubjectID), Marker: pCard.Marker || pCard.StateName, State: pCard.State })),
			EmptySlot: pLane.Cards.length ? [] : [{}]
		};
	}

	// The transitions out of a state, as a display list, for the move menu.
	_exitsFromState(pStateKey)
	{
		let tmpStateName = {};
		((this._Definition && this._Definition.States) || []).forEach((pState) => { tmpStateName[pState.Key] = pState.Name || pState.Key; });
		return ((this._Definition && this._Definition.Transitions) || [])
			.filter((pTransition) => pTransition.From === pStateKey)
			.map((pTransition) => ({ To: pTransition.To, ToName: tmpStateName[pTransition.To] || pTransition.To }));
	}

	_cardState(pSubjectID)
	{
		let tmpFound = null;
		(this._state().Lanes || []).forEach((pLane) => pLane.Cards.forEach((pCard) => { if (pCard.SubjectID === pSubjectID) { tmpFound = pCard; } }));
		return tmpFound;
	}

	/** Open the move menu for a card: the exits from its current state, as modal buttons. */
	moveCard(pSubjectID)
	{
		let tmpModal = this._modal();
		let tmpCard = this._cardState(pSubjectID);
		if (!tmpCard) { return; }
		let tmpExits = this._exitsFromState(tmpCard.State);
		if (!tmpModal) { return; }
		if (!tmpExits.length)
		{
			tmpModal.show({ title: 'No moves', content: '<p>There are no transitions out of this state.</p>', buttons: [ { Hash: 'ok', Label: 'OK', Style: 'primary' } ] });
			return;
		}
		let tmpButtons = tmpExits.map((pExit) => ({ Hash: pExit.To, Label: pExit.ToName }));
		tmpButtons.push({ Hash: '__cancel__', Label: 'Cancel' });
		tmpModal.show({ title: 'Move "' + (tmpCard.Title) + '"', content: '<p>Move to which state?</p>', buttons: tmpButtons }).then((pChoice) =>
		{
			if (!pChoice || pChoice === '__cancel__') { return; }
			this._advance(pSubjectID, pChoice);
		});
	}

	_advance(pSubjectID, pToState)
	{
		let tmpClient = this._client();
		if (!tmpClient) { return; }
		tmpClient.advance(pSubjectID, pToState).then(() =>
		{
			this._toast('Moved.', 'success');
			this.reload();
		}).catch((pError) =>
		{
			// A gated or blocked move comes back with the reason; show it, do not pretend it moved.
			let tmpModal = this._modal();
			if (tmpModal) { tmpModal.show({ title: 'That move is blocked', content: '<p>' + _escapeHTML(pError.message || 'The move was refused.') + '</p>', buttons: [ { Hash: 'ok', Label: 'OK', Style: 'primary' } ] }); }
		});
	}

	openSubject(pSubjectID)
	{
		let tmpCard = this._cardState(pSubjectID);
		if (typeof this.options.onOpenSubject === 'function') { this.options.onOpenSubject(pSubjectID, this._state().TypeRecord, tmpCard && tmpCard.Title); }
	}

	onAfterRender(pRenderable, pRenderDestinationAddress, pRecord, pContent)
	{
		this.pict.CSSMap.injectCSS();
		return super.onAfterRender(pRenderable, pRenderDestinationAddress, pRecord, pContent);
	}

	_toast(pMessage, pType) { let tmpModal = this._modal(); if (tmpModal && typeof tmpModal.toast === 'function') { tmpModal.toast(pMessage, { type: pType || 'info' }); } }
}

function _escapeHTML(pValue) { return String(pValue == null ? '' : pValue).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

module.exports = PictViewWorkflowBoard;
module.exports.default_configuration = _ViewConfiguration;
