/**
 * Internal AI QA Testing Platform - Diagnostics Collector
 * Aggregates runtime diagnostics, console errors, network failures and evidence assets.
 * Defined in Section 4.1.H of System Design v1.0.
 */

import crypto from 'node:crypto';
import { Redactor } from './redactor.js';

export class DiagnosticsCollector {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.consoleLogs = [];
    this.networkFailures = [];
    this.evidenceAssets = [];
  }

  addConsoleLog(type, message) {
    this.consoleLogs.push({
      type, // 'error', 'warn', 'info'
      message: Redactor.redactText(message),
      timestamp: new Date().toISOString()
    });
  }

  addNetworkFailure({ url, method, status, statusText, durationMs }) {
    this.networkFailures.push({
      url: Redactor.redactUrl(url),
      method: method || 'GET',
      status,
      statusText,
      durationMs,
      timestamp: new Date().toISOString()
    });
  }

  attachEvidence({ assetType, fileName, mimeType, dataBase64, fileSize }) {
    const hash = crypto.createHash('sha256').update(dataBase64 || '').digest('hex');
    const asset = {
      id: `att_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      assetType, // 'SCREENSHOT', 'VIDEO', 'TRACE', 'LOG'
      fileName,
      mimeType,
      storageKey: dataBase64, // local base64 or storage path
      fileSize: fileSize || (dataBase64 ? dataBase64.length : 0),
      sha256: hash,
      redactionStatus: 'NOT_REQUIRED',
      createdAt: new Date().toISOString()
    };
    this.evidenceAssets.push(asset);
    return asset;
  }

  getDiagnosticsSummary() {
    return {
      sessionId: this.sessionId,
      consoleErrorsCount: this.consoleLogs.filter(l => l.type === 'error').length,
      networkFailuresCount: this.networkFailures.length,
      evidenceAssetsCount: this.evidenceAssets.length,
      consoleLogs: this.consoleLogs.slice(-20), // Last 20 logs
      networkFailures: this.networkFailures.slice(-10), // Last 10 failed requests
      assets: this.evidenceAssets
    };
  }
}
