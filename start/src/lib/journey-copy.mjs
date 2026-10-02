// Fixed screen wording for the start journey. Question and answer wording lives
// in overview-preview.mjs. The page, the journey API messages and the Excalidraw
// map (scripts/journey-map.mjs) all read from here, so edit wording in one place.
// Chosen in the UAE-English wording pass (research/wording-pass-2026-09-25.md).
export const BRAND_TAGLINE = 'Your Health, Expertly Managed.';
export const COPY = Object.freeze({
  back:'← Back',
  continue:'Continue',
  change:'Change',
  welcome:{title:'Start with a clearer picture of your health', body:'Tell us about your health priorities and explore what Namat could offer you.'},
  eligible:{title:'Let’s explore your health priorities', body:'Next, tell us what matters most to you.'},
  pregnancyExit:{title:'Stay informed about future availability', body:'We can’t offer pregnancy care yet. Leave your email and we’ll contact you when a suitable service becomes available.', consent:'Please email me when Namat offers care during pregnancy.', button:'Register interest'},
  treatmentExit:{title:'Stay informed about future availability', body:'We can’t offer care alongside specialist treatment yet. Leave your email and we’ll contact you when a suitable service becomes available.', consent:'Please email me when Namat offers care alongside specialist treatment.', button:'Register interest'},
  availability:{demo:'Local demo: nothing will be sent or saved.', synthetic:'Synthetic test only: this request will be saved to the test database. No email will be sent.', saving:'Saving…'},
  notified:{title:'You’re on the list.', body:'Your interest is saved. We’ll email you when a suitable service becomes available.', savedTitle:'Your test request is saved', savedBody:'Your interest is saved in the test database.', savedNote:'Receipt {receipt}. No email has been sent.', button:'Back to Namat'},
  // Draft wording for the local review, awaiting the grouped copy choice.
  regionalInterest:{title:'Availability in your country', body:'We’re launching in the UAE first and planning to expand to Gulf countries as soon as possible.', consent:'Please use my email and the answers I’ve shared to register my interest and notify me about availability in my country.', button:'Register interest', confirmationTitle:'You’re on the list.', confirmationBody:'We’ve saved your interest. We’ll email you when Namat becomes available in your country.'},
  geographyExit:{title:'Availability in your country', body:'We’re currently accepting interest from the UAE, Bahrain, Kuwait, Oman, Qatar and Saudi Arabia.', button:'Back to Namat'},
  transition:{title:'Preparing your personal overview…', body:'This will only take a moment.', button:'Show my overview'},
  summary:{title:BRAND_TAGLINE, body:'This is what we’ll use to build your personalised health overview.', answers:'See all my answers', button:'Looks good'},
  priorities:{heading:'What matters to you', top:'Your top priority'},
  email:{kicker:'', title:'Your personalised health overview', firstNameLabel:'First name', label:'Email address', placeholder:'name@example.com', consent:'I agree to Namat using my answers and contact details to create and send my personalised health overview, as described in the Privacy Notice.', notice:'Test preview: the Privacy Notice must be reviewed before real information can be collected.', button:'View my overview'},
  urgent:'This form is not monitored for medical emergencies. In an emergency, call 998.',
  delivery:{title:'Your overview is ready.', body:'You can view your overview right now.', demo:'Local demo: no email has been sent.', saved:'Test database: answers saved (receipt {receipt}). No email has been sent.', button:'View it now'},
  overview:{
    title:'Your health overview', body:'A summary of the priorities and experiences you shared.', answers:'Your answers',
    stepsHeading:'Your Namat check-up, step by step',
    steps:['Share your health questionnaire.', 'Your doctor recommends the right tests, with home sample collection where available.', 'Receive your results with a doctor-reviewed care plan.', 'Regular follow-ups to track your progress.'],
    availability:'Availability in your area will be confirmed with you.',
    nextHeading:'Ready for the next step?', nextBody:'Our team can help arrange a consultation with a doctor. Your overview is yours to keep either way.',
    request:'Request a consultation', later:'Maybe later',
    disclaimer:'This overview is not a diagnosis or a medical assessment.',
    back:'Back',
  },
  // Purpose-specific interest requests. Route consent and the customer-facing
  // confirmation are approved; test modes remain labelled and mail stays off.
  routeChoices:{
    title:'Choose your next step', body:'Explore the two ways to start with Namat. Join the waitlist for the option that interests you.', status:'Joining the waitlist does not book an appointment or commit you to a purchase.',
    stepsHeading:'What happens next',
    steps:['Choose the option that interests you.', 'Join its waitlist with your email.', 'We’ll email you when details are ready, so you can decide whether to book.'],
  },
  routeWaitlist:{
    title:'Join the waitlist', body:'Leave your interest in this option. We’ll contact you when more details are available.',
    routeLabel:'Your selected option', emailLabel:'We’ll contact you at',
    consent:'I agree to receive emails from Namat about my {route} waitlist request, availability and next steps.',
    scope:'This is a request for updates about this option. No appointment is booked and no payment is taken.',
    review:'', demo:'Local demo: nothing will be sent or saved.',
    synthetic:'Synthetic test only: this request will be saved to the test database. No email will be sent.',
    button:'Join the waitlist', saving:'Saving…', change:'Change option',
    demoTitle:'Waitlist preview complete', demoReceipt:'You previewed joining the waitlist for {route} with {email}. Nothing was sent or saved.',
    confirmationTitle:'You’re on the list.',
    confirmationBody:'Your interest in {route} is saved. Look out for a confirmation from Borja at Namat, followed by updates when there’s more to share.',
    confirmationNote:'No appointment has been booked and no payment has been taken.',
    savedTitle:'Your test request is saved', savedReceipt:'Your interest in {route} has been saved with {email} in the test database.',
    savedNote:'Receipt {receipt}. No email has been sent and no appointment has been booked.',
    back:'Back to my overview', another:'Explore the other option', unavailable:'This option is not available to request here yet.',
  },
  restart:{link:'Start over', title:'Start over?', body:'This will clear all your answers.', confirm:'Yes, start over', cancel:'No, keep my answers'},
  errors:{firstName:'Please enter your first name (up to 80 characters).', email:'Please enter a valid email address.', consent:'Please tick the box to continue.', saveFailed:'Something went wrong. Please try again – your answers won’t be sent twice.', saveError:'Something went wrong. Please try again.'},
});
