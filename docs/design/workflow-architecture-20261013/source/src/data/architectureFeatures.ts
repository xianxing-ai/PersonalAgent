import data from './architecture.json';
export interface ArchitectureNode {
 id:string;label:string;kind:string;dependencies:string[];required:boolean;resourceKeys:string[];effectType:string;
 inputFields:string[];outputFields:string[];modelAssignment?:{vendor:string;model:string;role:string;thinkingLevel?:string};
 evidenceRequirement?:string;failureRoute?:string;condition?:string;
}
export interface ArchitectureEdge {id:string;source:string;target:string;required:boolean;branchLabel?:string;condition?:string}
export interface ArchitectureFeature {id:string;code:string;name:string;category:string;summary:string;decisionPoints:string[];nodes:ArchitectureNode[];edges:ArchitectureEdge[];recovery:string[]}
// 纯架构数据，没有执行状态、模拟结果或延迟占位。
export const ALL_FEATURES = data as ArchitectureFeature[];
