import assert from 'node:assert/strict';
import test from 'node:test';
import { assertNoPackingHold } from '../src/packing-guards.js';
import { createPackingService } from '../src/whatsapp-packing.js';

test('disabled packing reviews cannot create, approve, finalize or notify changes', async () => {
  const service = createPackingService({ reviewsEnabled: false, query: async () => { throw Error('Unexpected database access'); }, transaction: async () => { throw Error('Unexpected transaction'); } });
  assert.deepEqual(await service.list({} as any), {cases:[],canWarehouse:false,canSales:false,canOverride:false,enabled:false});
  for (const action of [service.open,service.report,service.act,service.retailerDecision,service.finalize]) await assert.rejects(() => action(...([] as any)), /Packing reviews are disabled/);
});

test('disabled reviews release packing holds while retaining delivery exception checks', async () => {
  for (const exception of [false,true]) {
    const db:any = { query: async (sql:string) => {
      if (sql.includes('whatsapp_packing_reviews')) throw Error('Disabled review should not be queried');
      if (sql.includes('sales_orders')) return {rows:[{cart:'SO-1'}],rowCount:1};
      return {rows:[],rowCount:sql.includes('delivery_exceptions') && exception ? 1 : 0};
    }};
    if (exception) await assert.rejects(() => assertNoPackingHold(db,['SO-1'],false), /unresolved delivery exception/);
    else await assertNoPackingHold(db,['SO-1'],false);
  }
});
