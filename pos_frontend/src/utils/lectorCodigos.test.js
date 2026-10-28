import test from 'node:test';
import assert from 'node:assert/strict';
import { variantesCodigo } from './lectorCodigos.js';

test('UPC-A de 12 dígitos también se busca como EAN-13', () => {
    assert.deepEqual(variantesCodigo('731299123456'), ['731299123456', '0731299123456']);
});

test('EAN-13 con 0 inicial también se busca como UPC-A', () => {
    assert.deepEqual(variantesCodigo('0731299123456'), ['0731299123456', '731299123456']);
});

test('otros códigos se buscan tal cual (sin espacios)', () => {
    assert.deepEqual(variantesCodigo(' 7801234567890 '), ['7801234567890']);
    assert.deepEqual(variantesCodigo('CAP-123'), ['CAP-123']);
});
