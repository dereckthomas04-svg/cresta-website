// ─────────────────────────────────────────────────────────────
//  SITE SETTINGS — edit these before launch.
// ─────────────────────────────────────────────────────────────
export const CONFIG = {
  brand: 'Cresta',
  email: 'crestaagencyco@gmail.com',          // shown on site + used for mailto fallback
  phone: '(760) 695-7951',               // display text
  phoneIntl: '+17606957951',             // used for the tap-to-call link
  whatsapp: '17606957951',               // digits only, with country code (wa.me link)
  hours: 'Mon–Fri, 9:00–17:00',            // shown in the footer; '' to hide
  location: '',                          // e.g. 'Austin, Texas' or full address; '' to hide
  bookingUrl: '',                        // e.g. Calendly link. Empty → opens the consultation form instead

  // Google PageSpeed Insights API key (optional but recommended: raises quota).
  // Create at console.cloud.google.com → APIs → PageSpeed Insights API.
  // Restrict it by HTTP referrer to your domain; it is safe to expose in the browser.
  psiKey: 'AIzaSyAxYj1njmj55Cfz79i8ReSYll1aWGCTbpE',

  // Analytics: fill one (or both). Empty → no analytics scripts load at all.
  ga4Id: '',                              // e.g. 'G-XXXXXXX'
  plausibleDomain: '',                    // e.g. 'crestaagency.com'


  // Real client testimonials ONLY. Leave empty until you have permission to publish.
  // { quote: { en: '...', es: '...' }, name: 'Jane Doe', role: 'Owner, Doe Dental', url: 'https://...' }
  testimonials: []
};
