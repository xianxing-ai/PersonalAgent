import {parentPort, workerData} from 'node:worker_threads';
import {KnowledgeError} from '../index.js';
import {parseWikiDocument} from './index.js';

if (parentPort) {
  try {
    const result = await parseWikiDocument({...workerData, signal: new AbortController().signal});
    parentPort.postMessage({result});
  } catch (error) {
    parentPort.postMessage({error: error instanceof KnowledgeError ? error.code : 'SOURCE_UNAVAILABLE'});
  }
}
