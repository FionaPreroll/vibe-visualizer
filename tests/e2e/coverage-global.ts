import MCR from 'monocart-coverage-reports';
import { COVERAGE, COVERAGE_OPTIONS } from './coverage';

/**
 * With E2E_COVERAGE set: drops the coverage of an earlier run before the tests, and writes the
 * report of this one after them (coverage/e2e/lcov.info).
 */
export default function globalSetup() {
  if (!COVERAGE) return;
  MCR(COVERAGE_OPTIONS).cleanCache();
  return async () => {
    await MCR(COVERAGE_OPTIONS).generate();
  };
}
