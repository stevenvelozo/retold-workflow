'use strict';

/**
 * retold-workflow
 *
 * A reusable, product-agnostic workflow capability built on the fable-workflow engine.
 * It is the middle tier of three:
 *
 *   fable-workflow   the pure engine (definitions, event log, projections, guards, agency)
 *   retold-workflow  this module: a workflow service, a built-in/clone type catalog, and
 *                    (in progress) board / timeline / metrics / agency UI
 *   <product>        the concrete wiring: tables, stores, a context resolver, seeds
 *
 * It stays reusable by depending only on injected interfaces, never on a product's
 * tables: an event store, a projection store, a type-catalog store, and a context
 * resolver. A product implements those over its own schema; an editorial-review product
 * and a manufacturing product implement the same four and get the same capability.
 *
 * Phase 1 ships the type catalog. The WorkflowService and the UI follow.
 *
 * @author Steven Velozo <steven@velozo.com>
 * @license MIT
 */

const libWorkflowTypeCatalog = require('./Workflow-Type-Catalog.js');
const libWorkflowService = require('./Workflow-Service.js');
const libBoardModel = require('./Board-Model.js');

module.exports =
{
	WorkflowTypeCatalog: libWorkflowTypeCatalog,
	WorkflowService: libWorkflowService,
	BoardModel: libBoardModel
};
