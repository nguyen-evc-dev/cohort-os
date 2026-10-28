/**
 * Điểm vào để gói code lõi cho Bé Sugar (Google Apps Script): chỉ những gì bot cần, không kéo theo Node / DOM.
 * Build: pnpm build:bot  → apps/bot/src/Core.generated.js (biến toàn cục CohortCore).
 */
export { findUngroundedNumbers, INSIGHT_MODEL } from './insight';
export { findPii } from './mask';
export { SKILLS } from './skills.generated';
export { auditAd, countFindings, lpScope, AUDIT_DOMAINS } from './audit';
