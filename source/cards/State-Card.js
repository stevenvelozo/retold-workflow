'use strict';

/**
 * StateCard: the pict-section-flow node type a workflow state renders as.
 *
 * One card type serves every state; the lane color is set per node by the marshaling (so all
 * lanes share this one card, colored individually), not baked into the card. The card carries
 * an input port for incoming transitions and an output port for outgoing ones, which is what
 * definitionToFlow wires connections between.
 *
 * The card declares an on-graph properties panel (double-click a state) over the state fields:
 * Name binds to the node Title, the rest to the node Data. It is a Template panel whose inputs
 * call back into the map view (resolved through AppData.WorkflowMap.ViewID) by node hash, so it
 * needs no form metacontroller and stays in step with the map's own edit + recolor logic. The
 * card Code matches Definition-Flow's STATE_NODE_TYPE so a node placed from the palette is the
 * same type the marshaling produces.
 *
 * @author Steven Velozo <steven@velozo.com>
 * @license MIT
 */

const libPictFlowCard = require('pict-section-flow').PictFlowCard;
const libDefinitionFlow = require('../Definition-Flow.js');

class StateCard extends libPictFlowCard
{
	constructor(pFable, pOptions, pServiceHash)
	{
		super(pFable, Object.assign(
			{},
			{
				Title: 'State',
				Name: 'Workflow State',
				Code: libDefinitionFlow.STATE_NODE_TYPE,
				Description: 'A state in the workflow. Incoming transitions arrive at In; outgoing transitions leave from Out.',
				Category: 'Workflow',
				TitleBarColor: '#3d6fb4',
				Width: 190,
				Height: 70,
				Inputs:
				[
					{ Name: 'In', Side: 'left' }
				],
				Outputs:
				[
					{ Name: 'Out', Side: 'right' }
				],
				PropertiesPanel:
				{
					PanelType: 'Template',
					DefaultWidth: 280,
					DefaultHeight: 250,
					Title: 'State',
					Configuration:
					{
						TemplateHash: 'Workflow-State-Panel',
						Templates:
						[
							{
								Hash: 'Workflow-State-Panel',
								Template: /*html*/`
<div class="wfp">
	<div class="wfp-field"><label class="wfp-label">Name</label><input type="text" class="wfp-input" value="{~D:Record.Title~}" {~D:AppData.WorkflowMap.DisabledAttr~} oninput="_Pict.views['{~D:AppData.WorkflowMap.ViewID~}'].editState('{~D:Record.Hash~}','Name',this.value)"></div>
	<div class="wfp-field"><label class="wfp-label">Lane</label><input type="text" class="wfp-input" list="WFMap-Lanes" value="{~D:Record.Data.Lane~}" {~D:AppData.WorkflowMap.DisabledAttr~} oninput="_Pict.views['{~D:AppData.WorkflowMap.ViewID~}'].editState('{~D:Record.Hash~}','Lane',this.value)"></div>
	<div class="wfp-field"><label class="wfp-label">Marker</label><input type="text" class="wfp-input" value="{~D:Record.Data.Marker~}" {~D:AppData.WorkflowMap.DisabledAttr~} oninput="_Pict.views['{~D:AppData.WorkflowMap.ViewID~}'].editState('{~D:Record.Hash~}','Marker',this.value)"></div>
	<label class="wfp-check"><input type="checkbox" {~NE:Record.Data.IsInitial^checked~} {~D:AppData.WorkflowMap.DisabledAttr~} onchange="_Pict.views['{~D:AppData.WorkflowMap.ViewID~}'].editState('{~D:Record.Hash~}','IsInitial',this.checked)"> Initial state</label>
	<label class="wfp-check"><input type="checkbox" {~NE:Record.Data.IsTerminal^checked~} {~D:AppData.WorkflowMap.DisabledAttr~} onchange="_Pict.views['{~D:AppData.WorkflowMap.ViewID~}'].editState('{~D:Record.Hash~}','IsTerminal',this.checked)"> Terminal state</label>
</div>`
							}
						]
					}
				}
			},
			pOptions),
			pServiceHash);
	}
}

module.exports = StateCard;
