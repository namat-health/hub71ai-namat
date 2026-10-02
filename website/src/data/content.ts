// Public claims come from the company deck and approved founder updates recorded in docs/claim-ledger.md.
export const content = {
  eyebrow: 'Preventive health · Abu Dhabi',
  hero: 'Health happens between appointments.',
  intro: 'We’re building a doctor-led approach to preventive health.',
  stage: 'In development',
  cta: 'Join the waitlist',
  problem: {
    label: 'The idea',
    title: 'From information to a plan.',
    body: 'A check-up is one moment. Namat’s planned approach connects your baseline, a plan, check-ins, retesting and adjustments.',
  },
  healthspan: {
    title: 'Living longer isn’t the same as living well.',
    // IHME GBD 2023 global figures, recorded in docs/claim-ledger.md. The gap is derived, never typed.
    // The trails illustrate these figures (accentuated, not to scale); the labels carry the exact numbers.
    lifeExpectancy: 73.8,
    healthyLifeExpectancy: 63.1,
    lifeLabel: 'Life expectancy',
    healthyLabel: 'Healthy life expectancy',
    gapCaption: 'in poor health',
    scope: 'Global averages at birth, 2023',
    source: {label: 'IHME, Global Burden of Disease Study 2023', href: 'https://www.healthdata.org/news-events/newsroom/news-releases/people-are-living-longer-spending-more-years-poor-health'},
  },
  productExplainer: {
    title: 'Look deeper across 150+ biomarkers.',
    titleAccent: 'Catch 1,000+ diseases earlier.',
    rows: [
      {
        label: 'Condition signals, first row',
        items: [
          {name: 'Chronic liver disease', image: '/assets/conditions/chronic-liver-disease.webp'},
          {name: 'Pancreatic cancer', image: '/assets/conditions/pancreatic-cancer.webp'},
          {name: 'Ovarian cancer', image: '/assets/conditions/ovarian-cancer.webp'},
          {name: 'Sickle cell disease', image: '/assets/conditions/sickle-cell-disease.webp'},
          {name: 'Diabetes', image: '/assets/conditions/diabetes.webp'},
          {name: 'Rheumatoid arthritis', image: '/assets/conditions/rheumatoid-arthritis.webp'},
        ],
      },
      {
        label: 'Condition signals, second row',
        items: [
          {name: 'Mold toxicity', image: '/assets/conditions/mold-toxicity.webp'},
          {name: 'Anemia', image: '/assets/conditions/anemia.webp'},
          {name: 'Gout', image: '/assets/conditions/gout.webp'},
          {name: 'Chronic kidney disease', image: '/assets/conditions/chronic-kidney-disease.webp'},
          {name: 'Hashimoto’s thyroiditis', image: '/assets/conditions/hashimotos-thyroiditis.webp'},
          {name: 'Prostate cancer', image: '/assets/conditions/prostate-cancer.webp'},
        ],
      },
      {
        label: 'Condition signals, third row',
        items: [
          {name: 'Lead toxicity', image: '/assets/conditions/lead-toxicity.webp'},
          {name: 'Hypogonadism', image: '/assets/conditions/hypogonadism.webp'},
          {name: 'Lupus', image: '/assets/conditions/lupus.webp'},
          {name: 'Coronary artery disease', image: '/assets/conditions/coronary-artery-disease.webp'},
          {name: 'Hypothyroidism', image: '/assets/conditions/hypothyroidism.webp'},
          {name: 'Alzheimer’s disease', image: '/assets/conditions/alzheimers-disease.webp'},
        ],
      },
    ],
  },
  audience: {
    label: 'Who we’re starting with',
    title: 'For people already investing in their health.',
    body: 'Expat professionals and Emiratis who want to turn their data into a plan and have guidance between check-ups.',
  },
  approach: {
    label: 'Our planned approach',
    title: 'A cycle of care.',
    note: 'Each cycle informs the next.',
    steps: [
      {number: '01', title: 'Baseline', body: 'Comprehensive testing to understand your health.'},
      {number: '02', title: 'Plan', body: 'A plan built around you.'},
      {number: '03', title: 'Check-ins', body: 'Support to put the plan into practice.'},
      {number: '04', title: 'Retest', body: 'See what’s changed and what still needs attention.'},
      {number: '05', title: 'Adjust', body: 'Your results and feedback shape the next cycle.'},
    ],
  },
  membership: {
    label: 'What we’re building',
    title: 'One connected cycle of care.',
    body: 'We’re designing Namat to bring the baseline, plan, check-ins, retesting and adjustments into one connected experience.',
    items: [
      {title: 'A clear starting point', body: 'Comprehensive testing intended to build a useful baseline.'},
      {title: 'A plan with context', body: 'A plan shaped around your information rather than a generic checklist.'},
      {title: 'Support between check-ups', body: 'Check-ins intended to help put the plan into practice.'},
      {title: 'A cycle that continues', body: 'Retesting and feedback intended to inform what comes next.'},
    ],
    status: 'Final testing scope, eligibility, launch timing and pricing are still being settled.',
    pricing: 'We’ll share confirmed details before asking anyone to purchase.',
  },
  // Shelved from the homepage on 29 September 2026 (founder request); kept for a later return.
  medicalLeadership: {
    faq: {question: 'Who leads Namat’s medical approach?', answer: 'Dr. Miguel Gómez Bravo is our co-founder and Chief Medical Officer. He is a European Board-Certified plastic surgeon with additional training in longevity medicine. At Namat, he leads the clinical approach to personalised protocols and ongoing review.'},
    name: 'Dr. Miguel Gómez Bravo',
    role: 'Co-founder and Chief Medical Officer',
    introduction: 'A European Board-Certified plastic surgeon with additional training in longevity medicine and a focus on metabolic health, nutrition, exercise and sleep.',
    body: 'At Namat, he brings this perspective to preventive care: shaping personalised protocols around your results, following your progress and refining your plan over time.',
    credentials: [
      {institution: 'Harvard Medical School', relationship: 'Fellowship', detail: 'Beth Israel Deaconess Medical Center', logo: 'harvard-medical-school', height: 248, displayWidth: '12.5rem'},
      {institution: 'Cleveland Clinic Abu Dhabi', relationship: 'Previous clinical practice', detail: 'Plastic surgery', logo: 'cleveland-clinic-abu-dhabi', height: 144, displayWidth: '18rem'},
      {institution: 'IESE Business School', relationship: 'Executive MBA', detail: 'Business administration', logo: 'iese-business-school', height: 167, displayWidth: '15rem'},
    ],
    socials: [
      {label: 'LinkedIn', href: 'https://ae.linkedin.com/in/dr-miguel-bravo'},
      {label: 'Instagram', href: 'https://www.instagram.com/dr_.bravo/'},
    ],
  },
  founders: {
    label: 'The founders', title: 'The people behind Namat.',
    people: [
      {name: 'Dr. Miguel Gómez Bravo', role: 'Co-founder', body: 'European Board-Certified plastic surgeon, now practising in Abu Dhabi.'},
      {name: 'Borja Martínez-Laredo', role: 'Co-founder', body: 'Building Namat full-time in Abu Dhabi.'},
    ],
  },
  status: {
    label: 'Where we are today', title: 'An idea taking shape.',
    body: 'Namat is preparing its planned pilot. Launch scope and costs are still being settled.',
  },
  faq: {
    label: 'Your questions',
    title: 'Frequently Asked Questions',
    items: [
      {question: 'What is Namat Health?', answer: 'Namat is a doctor-led approach to preventive health in Abu Dhabi. It connects comprehensive testing, a personalised plan, check-ins, retesting and adjustments into an ongoing relationship with your health.'},
      {question: 'Who is Namat for?', answer: 'People who want to be proactive about their health, understand their results and have guidance between check-ups. We’ll share confirmed eligibility and service details before you enrol.'},
      {question: 'How is this different from a one-off check-up?', answer: 'A check-up gives you a snapshot. Namat connects that starting point to a plan, support and repeat testing, so your next steps can reflect what has changed.'},
      {question: 'What does “150+ biomarkers” mean?', answer: 'Biomarkers are measurable indicators that help build a picture of your health. Namat’s testing covers more than 150 of these indicators, with results considered together and alongside your health history.'},
      {question: 'Do the tests diagnose every condition shown?', answer: 'No. The conditions shown are examples of what results may signal, not diagnoses a single test can confirm or rule out. An out-of-range result does not always mean illness, and an in-range result does not guarantee good health. Clinical review and further assessment may be needed.'},
      {question: 'What happens between tests?', answer: 'Check-ins and concierge support help you put your plan into practice. Your feedback and progress inform the next steps, so care continues between appointments.'},
      {question: 'Why retest, and how often?', answer: 'Retesting helps show what has changed and what still needs attention. The schedule needs to reflect your results and care plan; we haven’t announced a fixed interval for everyone.'},
      {question: 'Does Namat replace my regular doctor?', answer: 'Namat is focused on preventive health and ongoing guidance. It does not replace urgent care or treatment from your regular doctor or specialist. Do not delay care for symptoms while waiting for testing or a Namat appointment.'},
      {question: 'Where can I join Namat?', answer: 'Namat’s initial focus is Abu Dhabi. You can join the waitlist now, and we’ll share confirmed availability, eligibility and enrolment details by email.'},
      {question: 'How much will it cost? Is insurance accepted?', answer: 'Plans, pricing and insurance arrangements have not yet been announced. We’ll share confirmed details before asking you to purchase.'},
      {question: 'What happens when I join the waitlist?', answer: 'You’ll receive an email asking you to confirm your address. Once confirmed, you’ll receive Namat updates. Joining is an expression of interest—not a purchase, reservation or medical consultation.'},
      {question: 'What information does the waitlist collect?', answer: 'Just your email address and consent to receive updates—not your health information. You can unsubscribe from any waitlist email or contact us to request removal.', link: {href: '/privacy/', label: 'Read our privacy note.'}},
    ],
  },
  waitlist: {
    label: 'Stay in the loop', title: 'Be part of what comes next.',
    body: 'Join the waitlist for updates from Namat Health.',
    consent: 'I’d like to receive Namat Health waitlist updates by email.',
    note: 'Joining the waitlist is an expression of interest, not a medical consultation or a purchase.',
  },
  email: 'borja@namat.health',
} as const;

export const directions = [
  {slug:'dune', name:'Dune', number:'01', tagline:'Warm editorial. Sand, generous serif type, and an open horizon.', palette:'#eae3d3', order:['problem','approach','audience','founders','status'], image:'dune'},
  {slug:'fieldnotes', name:'Fieldnotes', number:'02', tagline:'Precise and structured. An oversized typographic grid with a practical rhythm.', palette:'#e4ecdd', order:['approach','problem','founders','audience','status'], image:null},
  {slug:'afterglow', name:'Afterglow', number:'03', tagline:'Dark and atmospheric. Coastal imagery, quiet light, and cinematic scale.', palette:'#163f3b', order:['problem','audience','approach','founders','status'], image:'coast'},
  {slug:'journal', name:'Journal', number:'04', tagline:'Bold magazine. Terracotta, oversized headlines, and asymmetric columns.', palette:'#cf6848', order:['audience','problem','founders','approach','status'], image:'dune'},
  {slug:'continuum', name:'Continuum', number:'05', tagline:'A flowing journey. Soft sage, a vertical care sequence, and a split-screen welcome.', palette:'#b9c8bd', order:['approach','audience','problem','founders','status'], image:'coast'},
] as const;
export type Direction = (typeof directions)[number];
