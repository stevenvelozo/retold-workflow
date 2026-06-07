'use strict';

/**
 * retold-workflow - Workflow-Client tests
 *
 * The reference client builds the standard routes, unwraps the payloads, threads an auth header,
 * and turns a non-2xx into an Error whose message is the server's reason (so a gated advance
 * surfaces why). A recording fake fetch stands in for the network.
 */

const libAssert = require('node:assert');
const libWorkflowClient = require('../source/Workflow-Client.js');

// A fake fetch that records calls and replies from a scripted queue.
function makeFetch(pReplies)
{
	let tmpCalls = [];
	let tmpQueue = pReplies.slice();
	let fFetch = (pUrl, pOptions) =>
	{
		tmpCalls.push({ url: pUrl, options: pOptions });
		let tmpReply = tmpQueue.shift() || { ok: true, status: 200, body: {} };
		return Promise.resolve(
			{
				ok: tmpReply.ok !== false,
				status: tmpReply.status || 200,
				json: () => Promise.resolve(tmpReply.body || {})
			});
	};
	fFetch.calls = tmpCalls;
	return fFetch;
}

suite('retold-workflow: Workflow-Client', () =>
{
	test('getTypes hits {base}/Types and unwraps the array', async () =>
	{
		let fFetch = makeFetch([{ body: { Types: [{ ID: 1 }, { ID: 2 }] } }]);
		let tmpClient = new libWorkflowClient({ BasePath: '/1.0/Workflow', Fetch: fFetch });
		let tmpTypes = await tmpClient.getTypes();
		libAssert.strictEqual(tmpCallURL(fFetch, 0), '/1.0/Workflow/Types');
		libAssert.strictEqual(fFetch.calls[0].options.method, 'GET');
		libAssert.deepStrictEqual(tmpTypes.map((pType) => pType.ID), [1, 2]);
	});

	test('adoptType posts the BuiltInID and unwraps Type', async () =>
	{
		let fFetch = makeFetch([{ body: { Type: { ID: 9 } } }]);
		let tmpClient = new libWorkflowClient({ Fetch: fFetch });
		let tmpType = await tmpClient.adoptType(7);
		libAssert.strictEqual(fFetch.calls[0].options.method, 'POST');
		libAssert.strictEqual(tmpCallURL(fFetch, 0), '/1.0/Workflow/Types/Adopt');
		libAssert.deepStrictEqual(JSON.parse(fFetch.calls[0].options.body), { BuiltInID: 7 });
		libAssert.strictEqual(tmpType.ID, 9);
	});

	test('getBoard / saveLayout build the per-type routes', async () =>
	{
		let fFetch = makeFetch([{ body: { Board: [{ ID: 3, State: 'todo' }] } }, { body: { Layout: { todo: { X: 1, Y: 2 } } } }]);
		let tmpClient = new libWorkflowClient({ Fetch: fFetch });
		let tmpBoard = await tmpClient.getBoard(42);
		let tmpLayout = await tmpClient.saveLayout(42, { todo: { X: 1, Y: 2 } });
		libAssert.strictEqual(tmpCallURL(fFetch, 0), '/1.0/Workflow/Types/42/Board');
		libAssert.strictEqual(tmpCallURL(fFetch, 1), '/1.0/Workflow/Types/42/Layout');
		libAssert.strictEqual(fFetch.calls[1].options.method, 'PUT');
		libAssert.strictEqual(tmpBoard[0].State, 'todo');
		libAssert.deepStrictEqual(tmpLayout, { todo: { X: 1, Y: 2 } });
	});

	test('advance returns the body on success', async () =>
	{
		let fFetch = makeFetch([{ body: { Advanced: true, State: { CurrentStates: ['todo'] } } }]);
		let tmpClient = new libWorkflowClient({ Fetch: fFetch });
		let tmpResult = await tmpClient.advance(5, 'todo');
		libAssert.strictEqual(tmpCallURL(fFetch, 0), '/1.0/Workflow/Subject/5/Advance');
		libAssert.deepStrictEqual(JSON.parse(fFetch.calls[0].options.body), { ToState: 'todo' });
		libAssert.strictEqual(tmpResult.Advanced, true);
	});

	test('a gated advance (409) rejects with the server reason as the message', async () =>
	{
		let fFetch = makeFetch([{ ok: false, status: 409, body: { Error: 'actor lacks the "content.approve" entitlement' } }]);
		let tmpClient = new libWorkflowClient({ Fetch: fFetch });
		await libAssert.rejects(() => tmpClient.advance(5, 'approved'),
			(pError) => pError.statusCode === 409 && /content\.approve/.test(pError.message));
	});

	test('a Headers function is applied per request (bearer token)', async () =>
	{
		let fFetch = makeFetch([{ body: { Types: [] } }]);
		let tmpClient = new libWorkflowClient({ Fetch: fFetch, Headers: () => ({ Authorization: 'Bearer abc123' }) });
		await tmpClient.getTypes();
		libAssert.strictEqual(fFetch.calls[0].options.headers['Authorization'], 'Bearer abc123');
	});
});

function tmpCallURL(pFetch, pIndex) { return pFetch.calls[pIndex].url; }
