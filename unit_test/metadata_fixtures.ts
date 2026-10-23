import type { MetadataRequest, MetadataResult } from '@/lib/metadata/contracts';
export const operationId='40000000-0000-4000-8000-000000000001';
export const entityId='30000000-0000-4000-8000-000000000001';
export const zoneId='60000000-0000-4000-8000-000000000001';
export const item={name:'Test ingredient',unit:'can',min_threshold:3};
export const journal:MetadataRequest={operationId,resource:'INGREDIENT',action:'UPDATE',id:entityId,item,expected:{...item,name:'Before'}};
export const result:MetadataResult={operationId,resource:'INGREDIENT',action:'UPDATE',entityId};
