'use strict';

/**
 * The browser layer of retold-workflow: the Pict views and the StateCard, which depend on
 * pict-section-flow (and pict-view). A product's client bundle requires this entry; a product's
 * server requires the main entry (./Retold-Workflow.js), which stays free of pict.
 *
 * Register the views on a host pict app and hand each one an API client (the WorkflowClient
 * shape) via options.Client or a named provider (options.ClientProvider). The pure cores and the
 * client are re-exported here too, so a bundle has one place to reach everything.
 *
 * @author Steven Velozo <steven@velozo.com>
 * @license MIT
 */

const libCore = require('./Retold-Workflow.js');

module.exports =
{
	// Pure cores + isomorphic client (re-exported from the main entry).
	WorkflowTypeCatalog: libCore.WorkflowTypeCatalog,
	WorkflowService: libCore.WorkflowService,
	BoardModel: libCore.BoardModel,
	DefinitionFlow: libCore.DefinitionFlow,
	MetricsFormat: libCore.MetricsFormat,
	WorkflowClient: libCore.WorkflowClient,

	// The node card and the four views.
	StateCard: require('./cards/State-Card.js'),
	WorkflowMapView: require('./views/PictView-Workflow-Map.js'),
	WorkflowBoardView: require('./views/PictView-Workflow-Board.js'),
	WorkflowSubjectView: require('./views/PictView-Workflow-Subject.js'),
	WorkflowCatalogView: require('./views/PictView-Workflow-Catalog.js')
};
