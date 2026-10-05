// Québec payroll parameters. Update this file every January 1 (and minimum wages every May 1).
//
// Sources, checked September 2026:
//  - CRA T4032-QC, January 2026 (federal brackets, basic personal amount, Canada employment amount,
//    16.5% Québec abatement, EI 1.30% on $68,900)
//  - Finances Québec, "Parameters of the personal income tax system for 2026" (indexation 2.05%,
//    brackets, $18,952 basic personal amount, $1,450 deduction for workers)
//  - Raymond Chabot Grant Thornton Tax News 930R4, February 2026 (QPP, QPIP, HSF, CNT)
//  - CNESST, minimum wage effective May 1, 2026 ($16.60 general, $13.30 employees receiving tips)
export const QC_RATES = {
  year: 2026,
  federal: {
    brackets: [[58523, 0.14], [117045, 0.205], [181440, 0.26], [258482, 0.29], [Infinity, 0.33]],
    lowestRate: 0.14,
    basicPersonalAmount: 16452,
    canadaEmploymentAmount: 1501,
    quebecAbatement: 0.165, // federal tax is reduced by 16.5% for Québec employees
  },
  quebec: {
    brackets: [[54345, 0.14], [108680, 0.19], [132245, 0.24], [Infinity, 0.2575]],
    lowestRate: 0.14,
    basicPersonalAmount: 18952,
    workerDeductionRate: 0.06, // deduction for workers: 6% of employment income…
    workerDeductionMax: 1450, // …up to this amount
  },
  qpp: {
    basicExemption: 3500,
    maxPensionable: 74600, // MPE
    maxPensionableAdditional: 85000, // second ceiling for QPP2
    rate: 0.063, // employee share; the employer pays the same
    baseRate: 0.053, // part of the 6.3% that earns a federal tax credit
    firstAdditionalRate: 0.01, // part of the 6.3% that is deducted from income instead
    secondAdditionalRate: 0.04, // QPP2, on earnings between the two ceilings (deductible)
    maxContribution: 4479.3,
  },
  ei: { rate: 0.013, employerMultiplier: 1.4, maxInsurable: 68900, maxPremium: 895.7 },
  qpip: { rate: 0.0043, employerRate: 0.00602, maxInsurable: 103000, maxPremium: 442.9, maxEmployer: 620.06 },
  cnt: { rate: 0.0006, maxEarnings: 103000 }, // labour standards contribution (employer)
  minimumWage: { general: 16.6, tipped: 13.3, effective: '2026-05-01' },
};
