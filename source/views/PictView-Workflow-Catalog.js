'use strict';

/**
 * The type catalog and picker.
 *
 * The union list from the client: built-ins (labeled) plus the tenant's own types. A built-in the
 * tenant has not taken yet offers Adopt; one already adopted says so. An owned type that was
 * cloned from a built-in shows a drift note when the built-in has since advanced (computed here
 * from the same list: the built-in's Version against the clone's SourceVersion). This is the entry
 * point to the rest: opening a type hands it to the host (which shows the designer or the board).
 *
 * @author Steven Velozo <steven@velozo.com>
 * @license MIT
 */

const libPictView = require('pict-view');

const _ViewConfiguration =
{
	ViewIdentifier: 'Workflow-Catalog',
	DefaultRenderable: 'Workflow-Catalog-Container',
	DefaultDestinationAddress: '#Workflow-Catalog-Container',
	AutoRender: false,

	ClientProvider: 'WorkflowAPI',
	Client: null,

	CSS: /*css*/`
		.wfc { padding: 0.25em; }
		.wfc-head { font-size: 1.2em; font-weight: 600; margin: 0 0 0.75em; }
		.wfc-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 0.75em; }
		.wfc-card { border: 1px solid var(--theme-color-border-default, #ddd); border-radius: 7px; padding: 0.8em; background: var(--theme-color-background-panel, #fff); display: flex; flex-direction: column; }
		.wfc-card-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.3em; }
		.wfc-card-name { font-weight: 600; font-size: 1.02em; }
		.wfc-badge { font-size: 0.7em; padding: 0.12em 0.5em; border-radius: 10px; background: var(--theme-color-background-tertiary, #eee); color: var(--theme-color-text-secondary, #666); }
		.wfc-badge-builtin { background: var(--theme-color-brand-primary, #2e7d74); color: #fff; }
		.wfc-desc { font-size: 0.85em; color: var(--theme-color-text-secondary, #666); line-height: 1.45; flex: 1; margin-bottom: 0.6em; }
		.wfc-drift { font-size: 0.78em; color: var(--theme-color-status-warning, #b9770e); background: var(--theme-color-status-warning-background, #fdf6e3); border-radius: 4px; padding: 0.3em 0.5em; margin-bottom: 0.5em; }
		.wfc-actions { display: flex; gap: 0.4em; flex-wrap: wrap; }
		.wfc-btn { padding: 0.35em 0.7em; border: 1px solid var(--theme-color-border-default, #ccc); border-radius: 5px; background: var(--theme-color-background-panel, #fff); cursor: pointer; font-size: 0.85em; }
		.wfc-btn:hover { background: var(--theme-color-background-hover, #f1f1f1); }
		.wfc-btn-primary { background: var(--theme-color-brand-primary, #2e7d74); border-color: var(--theme-color-brand-primary, #2e7d74); color: #fff; }
		.wfc-adopted-note { font-size: 0.78em; color: var(--theme-color-text-secondary, #888); align-self: center; }
		.wfc-empty, .wfc-loading { color: var(--theme-color-text-secondary, #888); padding: 1em 0; }
	`,

	Templates:
	[
		{
			Hash: 'Workflow-Catalog-Container',
			Template: /*html*/`
<div class="wfc">
	<div class="wfc-head">Workflows</div>
	{~TS:Workflow-Catalog-Loading:AppData.WorkflowCatalog.LoadingSlot~}
	<div class="wfc-list">{~TS:Workflow-Catalog-Card:AppData.WorkflowCatalog.Rows~}</div>
	{~TS:Workflow-Catalog-Empty:AppData.WorkflowCatalog.EmptySlot~}
</div>`
		},
		{ Hash: 'Workflow-Catalog-Loading', Template: /*html*/`<div class="wfc-loading">Loading workflows...</div>` },
		{ Hash: 'Workflow-Catalog-Empty', Template: /*html*/`<div class="wfc-empty">No workflows yet.</div>` },
		{
			Hash: 'Workflow-Catalog-Card',
			Template: /*html*/`
<div class="wfc-card">
	<div class="wfc-card-top">
		<span class="wfc-card-name">{~D:Record.Name~}</span>
		<span class="wfc-badge {~D:Record.BadgeClass~}">{~D:Record.OriginLabel~}</span>
	</div>
	<div class="wfc-desc">{~D:Record.Description~}</div>
	{~TS:Workflow-Catalog-Drift:Record.DriftSlot~}
	<div class="wfc-actions">
		<button class="wfc-btn wfc-btn-primary" onclick="_Pict.views['{~D:AppData.WorkflowCatalog.ViewID~}'].openType('{~D:Record.RowKey~}')">{~D:Record.OpenLabel~}</button>
		{~TS:Workflow-Catalog-Board:Record.BoardSlot~}
		{~TS:Workflow-Catalog-Adopt:Record.AdoptSlot~}
		{~TS:Workflow-Catalog-Adopted:Record.AdoptedSlot~}
	</div>
</div>`
		},
		{ Hash: 'Workflow-Catalog-Drift', Template: /*html*/`<div class="wfc-drift">{~D:Record.Text~}</div>` },
		{ Hash: 'Workflow-Catalog-Board', Template: /*html*/`<button class="wfc-btn" onclick="_Pict.views['{~D:AppData.WorkflowCatalog.ViewID~}'].openBoard('{~D:Record.RowKey~}')">Board</button>` },
		{ Hash: 'Workflow-Catalog-Adopt', Template: /*html*/`<button class="wfc-btn" onclick="_Pict.views['{~D:AppData.WorkflowCatalog.ViewID~}'].adopt('{~D:Record.RowKey~}')">Adopt</button>` },
		{ Hash: 'Workflow-Catalog-Adopted', Template: /*html*/`<span class="wfc-adopted-note">In use</span>` }
	],

	Renderables:
	[
		{ RenderableHash: 'Workflow-Catalog-Container', TemplateHash: 'Workflow-Catalog-Container', DestinationAddress: '#Workflow-Catalog-Container', RenderMethod: 'replace' }
	]
};

class PictViewWorkflowCatalog extends libPictView
{
	onBeforeInitialize()
	{
		if (!this.pict.AppData.WorkflowCatalog)
		{
			this.pict.AppData.WorkflowCatalog = { ViewID: this.options.ViewIdentifier, Rows: [], LoadingSlot: [], EmptySlot: [] };
		}
		this.pict.AppData.WorkflowCatalog.ViewID = this.options.ViewIdentifier;
		return super.onBeforeInitialize();
	}

	_state() { return this.pict.AppData.WorkflowCatalog; }
	_client() { if (this.options.Client) { return this.options.Client; } let tmpName = this.options.ClientProvider || 'WorkflowAPI'; return (this.pict.providers && this.pict.providers[tmpName]) || null; }
	_modal() { return this.pict.views['Pict-Section-Modal'] || null; }

	reload()
	{
		let tmpState = this._state();
		let tmpClient = this._client();
		if (!tmpClient) { this.render(); return Promise.resolve(); }
		tmpState.LoadingSlot = [{}]; tmpState.EmptySlot = [];
		this.render();
		return tmpClient.getTypes().then((pTypes) =>
		{
			this._Types = pTypes || [];
			tmpState.Rows = this._buildRows(this._Types);
			tmpState.LoadingSlot = [];
			tmpState.EmptySlot = tmpState.Rows.length ? [] : [{}];
			this.render();
		}).catch((pError) =>
		{
			tmpState.LoadingSlot = [];
			this._toast('Could not load workflows: ' + pError.message, 'error');
			this.render();
		});
	}

	_buildRows(pTypes)
	{
		let tmpBuiltInVersion = {};
		pTypes.forEach((pType) => { if (pType.Origin === 'builtin') { tmpBuiltInVersion[pType.ID] = Number(pType.Version); } });

		return pTypes.map((pType) =>
		{
			let tmpIsBuiltIn = (pType.Origin === 'builtin');
			let tmpAdopted = tmpIsBuiltIn && (pType.AdoptedAsID != null);
			let tmpDriftSlot = [];
			if (!tmpIsBuiltIn && pType.SourceID != null && tmpBuiltInVersion[pType.SourceID] != null)
			{
				if (tmpBuiltInVersion[pType.SourceID] > Number(pType.SourceVersion))
				{
					tmpDriftSlot = [{ Text: 'Update available: the built-in is now version ' + tmpBuiltInVersion[pType.SourceID] + ' (this copy is from version ' + pType.SourceVersion + ').' }];
				}
			}
			// Built-ins and owned types live in separate id spaces whose numbers collide (both can be
			// 1), so a composite Origin+ID key is what the buttons pass back to pick the right record.
			let tmpRowKey = pType.Origin + '|' + pType.ID;
			return {
				ID: pType.ID,
				RowKey: tmpRowKey,
				Name: pType.Name || pType.TypeKey || ('Type ' + pType.ID),
				Description: pType.Description || '',
				OriginLabel: tmpIsBuiltIn ? 'Built-in' : 'Yours',
				BadgeClass: tmpIsBuiltIn ? 'wfc-badge-builtin' : '',
				OpenLabel: tmpIsBuiltIn ? 'View' : 'Open designer',
				DriftSlot: tmpDriftSlot,
				BoardSlot: tmpIsBuiltIn ? [] : [{ RowKey: tmpRowKey }],
				AdoptSlot: (tmpIsBuiltIn && !tmpAdopted) ? [{ RowKey: tmpRowKey }] : [],
				AdoptedSlot: (tmpIsBuiltIn && tmpAdopted) ? [{}] : []
			};
		});
	}

	_typeByRowKey(pRowKey) { return (this._Types || []).find((pType) => (pType.Origin + '|' + pType.ID) === pRowKey) || null; }

	openType(pRowKey)
	{
		let tmpType = this._typeByRowKey(pRowKey);
		if (tmpType && typeof this.options.onOpenType === 'function') { this.options.onOpenType(tmpType); }
	}

	openBoard(pRowKey)
	{
		let tmpType = this._typeByRowKey(pRowKey);
		if (tmpType && typeof this.options.onShowBoard === 'function') { this.options.onShowBoard(tmpType); }
	}

	adopt(pRowKey)
	{
		let tmpClient = this._client();
		let tmpType = this._typeByRowKey(pRowKey);
		if (!tmpClient || !tmpType) { return; }
		tmpClient.adoptType(tmpType.ID).then((pClone) =>
		{
			this._toast('Adopted into your workflows.', 'success');
			return this.reload().then(() =>
			{
				if (pClone && typeof this.options.onOpenType === 'function') { this.options.onOpenType(Object.assign({}, pClone, { Origin: 'owned' })); }
			});
		}).catch((pError) => this._toast('Could not adopt: ' + pError.message, 'error'));
	}

	onAfterRender(pRenderable, pRenderDestinationAddress, pRecord, pContent)
	{
		this.pict.CSSMap.injectCSS();
		return super.onAfterRender(pRenderable, pRenderDestinationAddress, pRecord, pContent);
	}

	_toast(pMessage, pType) { let tmpModal = this._modal(); if (tmpModal && typeof tmpModal.toast === 'function') { tmpModal.toast(pMessage, { type: pType || 'info' }); } }
}

module.exports = PictViewWorkflowCatalog;
module.exports.default_configuration = _ViewConfiguration;
