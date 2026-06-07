'use strict';

/**
 * Reference API client for the workflow views.
 *
 * Every view in this module renders from data and calls an injected client; this is the client a
 * product can use as-is, or copy. It is a thin fetch wrapper over a configurable base path with a
 * configurable auth header, hitting the standard workflow routes. A product whose routes match
 * (plansheet's /1.0/Workflow do) passes one of these to the views and is done.
 *
 * Options:
 *   BasePath     route root, default '/1.0/Workflow'
 *   Fetch        fetch implementation, default the global fetch (override in tests / node)
 *   Headers      a headers object, or a function returning one (for a per-request bearer token)
 *   Credentials  fetch credentials mode, default 'same-origin' (so cookie auth works in browser)
 *
 * The route map (a product implements these to reuse the views):
 *   GET    {base}/Types                      -> { Types: [typeRecord] }
 *   GET    {base}/Types/:id                  -> { Type: typeRecord }
 *   POST   {base}/Types/Adopt   {BuiltInID}  -> { Type: typeRecord }
 *   PUT    {base}/Types/:id      {Definition}-> { Type: typeRecord }
 *   GET    {base}/Types/:id/Board            -> { Board: [{ ID, State, Title }] }
 *   GET    {base}/Types/:id/Layout           -> { Layout: { stateKey: { X, Y } } }
 *   PUT    {base}/Types/:id/Layout {Layout}  -> { Layout }
 *   POST   {base}/Subject/:id/Open           -> { State }
 *   POST   {base}/Subject/:id/Advance {ToState} -> { Advanced, State }   (409 + {Error} when gated)
 *   POST   {base}/Subject/:id/Reevaluate     -> { Exits }
 *   GET    {base}/Subject/:id                -> { State, Exits }
 *   GET    {base}/Subject/:id/Timeline       -> { Timeline }
 *   GET    {base}/Subject/:id/Metrics        -> { Metrics }
 *   GET    {base}/Subject/:id/Agency         -> { Agency }
 *
 * Read methods resolve to the unwrapped payload (getTypes resolves the array, not { Types }).
 * A non-2xx rejects with an Error carrying .statusCode and the server's Error message, so a view
 * can show a blocked advance's reason straight from error.message.
 *
 * @author Steven Velozo <steven@velozo.com>
 * @license MIT
 */

class WorkflowClient
{
	constructor(pOptions)
	{
		let tmpOptions = pOptions || {};
		this.basePath = _trimTrailingSlash(tmpOptions.BasePath || '/1.0/Workflow');
		this._fetch = tmpOptions.Fetch || (typeof fetch === 'function' ? fetch.bind(null) : null);
		this._headers = tmpOptions.Headers || null;
		this._credentials = tmpOptions.Credentials || 'same-origin';
	}

	// -- types / catalog -------------------------------------------------------

	getTypes() { return this._request('GET', '/Types').then((pBody) => (pBody && pBody.Types) || []); }

	getType(pTypeID) { return this._request('GET', '/Types/' + encodeURIComponent(pTypeID)).then((pBody) => (pBody && pBody.Type) || null); }

	adoptType(pBuiltInID) { return this._request('POST', '/Types/Adopt', { BuiltInID: pBuiltInID }).then((pBody) => (pBody && pBody.Type) || null); }

	saveType(pTypeID, pDefinition) { return this._request('PUT', '/Types/' + encodeURIComponent(pTypeID), { Definition: pDefinition }).then((pBody) => (pBody && pBody.Type) || null); }

	// -- board + layout (the two product-added routes) -------------------------

	getBoard(pTypeID) { return this._request('GET', '/Types/' + encodeURIComponent(pTypeID) + '/Board').then((pBody) => (pBody && pBody.Board) || []); }

	getLayout(pTypeID) { return this._request('GET', '/Types/' + encodeURIComponent(pTypeID) + '/Layout').then((pBody) => (pBody && pBody.Layout) || {}); }

	saveLayout(pTypeID, pLayout) { return this._request('PUT', '/Types/' + encodeURIComponent(pTypeID) + '/Layout', { Layout: pLayout }).then((pBody) => (pBody && pBody.Layout) || {}); }

	// -- one subject -----------------------------------------------------------

	open(pSubjectID) { return this._request('POST', '/Subject/' + encodeURIComponent(pSubjectID) + '/Open', {}).then((pBody) => (pBody && pBody.State) || null); }

	advance(pSubjectID, pToState) { return this._request('POST', '/Subject/' + encodeURIComponent(pSubjectID) + '/Advance', { ToState: pToState }); }

	reevaluate(pSubjectID) { return this._request('POST', '/Subject/' + encodeURIComponent(pSubjectID) + '/Reevaluate', {}).then((pBody) => (pBody && pBody.Exits) || []); }

	getSubject(pSubjectID) { return this._request('GET', '/Subject/' + encodeURIComponent(pSubjectID)); }

	getTimeline(pSubjectID) { return this._request('GET', '/Subject/' + encodeURIComponent(pSubjectID) + '/Timeline').then((pBody) => (pBody && pBody.Timeline) || []); }

	getMetrics(pSubjectID) { return this._request('GET', '/Subject/' + encodeURIComponent(pSubjectID) + '/Metrics').then((pBody) => (pBody && pBody.Metrics) || null); }

	getAgency(pSubjectID) { return this._request('GET', '/Subject/' + encodeURIComponent(pSubjectID) + '/Agency').then((pBody) => (pBody && pBody.Agency) || []); }

	// -- internals -------------------------------------------------------------

	_resolveHeaders()
	{
		let tmpHeaders = { 'Accept': 'application/json' };
		let tmpExtra = (typeof this._headers === 'function') ? this._headers() : this._headers;
		if (tmpExtra && typeof tmpExtra === 'object')
		{
			Object.keys(tmpExtra).forEach((pKey) => { tmpHeaders[pKey] = tmpExtra[pKey]; });
		}
		return tmpHeaders;
	}

	_request(pMethod, pPath, pBody)
	{
		if (!this._fetch) { return Promise.reject(new Error('WorkflowClient has no fetch implementation')); }
		let tmpHeaders = this._resolveHeaders();
		let tmpOptions = { method: pMethod, headers: tmpHeaders, credentials: this._credentials };
		if (pBody !== undefined)
		{
			tmpHeaders['Content-Type'] = 'application/json';
			tmpOptions.body = JSON.stringify(pBody);
		}
		return this._fetch(this.basePath + pPath, tmpOptions).then((pResponse) =>
		{
			return pResponse.json().catch(() => ({})).then((pData) =>
			{
				if (!pResponse.ok)
				{
					let tmpError = new Error((pData && pData.Error) || ('HTTP ' + pResponse.status));
					tmpError.statusCode = pResponse.status;
					throw tmpError;
				}
				return pData;
			});
		});
	}
}

function _trimTrailingSlash(pPath) { return (pPath && pPath.charAt(pPath.length - 1) === '/') ? pPath.slice(0, -1) : pPath; }

module.exports = WorkflowClient;
