import React, { useEffect, useRef, useState } from 'react';

import { Heart, Mail, MessageCircle, Send, ShieldCheck, X } from './icons.jsx';
// Absolute base for backend functions. Relative '/functions/...' breaks in the
// published native app (Capacitor origin https://localhost/) and on the GitHub
// Pages / tunnel host, where it would resolve to the wrong origin. Always call
// the base44 backend directly.
const FUNCTIONS_BASE = 'https://superagent-934909c8.base44.app/functions';
export function PrivacyStatementPopup({ onClose }) {
  return <div className="settings-modal-backdrop privacy-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="settings-modal privacy-modal" role="dialog" aria-modal="true" aria-label="Privacy Statement">
      <button type="button" className="settings-modal-close privacy-close" onClick={onClose} aria-label="Close privacy statement"><span className="privacy-close-symbol" aria-hidden="true">×</span></button>
      <article className="privacy-document privacy-document-classic">
        <h2>Privacy Statement</h2>
        <p><strong>Last Updated:</strong> June 30, 2026</p>
        <p>This Privacy Statement explains how we collect, use, and protect <a href="#" onClick={event => event.preventDefault()}>your</a> information when you use our app. By using the app, you agree to the practices described below.</p>

        <h3>1. Information We Collect</h3>
        <p>We may collect the following types of information:</p>
        <ul>
          <li><strong>Personal Information:</strong> such as your name, email address, or account details when you create an account or contact support.</li>
          <li><strong>Device Information:</strong> including device type, operating system, and app usage data to help us improve performance.</li>
          <li><strong>Location Information:</strong> if you enable location services, we may collect your current location to provide location-based features.</li>
          <li><strong>Interaction Data:</strong> such as actions taken within the app, preferences, and settings.</li>
        </ul>

        <h3>2. How We Use Your Information</h3>
        <p>We use the information we collect to:</p>
        <ul>
          <li>Provide and improve app features and services</li>
          <li>Personalize your experience</li>
          <li>Respond to support requests</li>
          <li>Enhance security and prevent misuse</li>
          <li>Send important updates or notifications related to the app</li>
        </ul>

        <h3>3. How We Share Your Information</h3>
        <p>We do <strong>not</strong> sell your personal information. We may share information only in the following cases:</p>
        <ul>
          <li>With trusted service providers who assist in operating the app</li>
          <li>When required by law, regulation, or legal process</li>
          <li>To protect the rights, safety, and security of users or the app</li>
        </ul>

        <h3>4. Data Security</h3>
        <p>We use industry-standard security measures to protect your information. However, no system is completely secure, and we encourage you to use strong passwords and keep your device protected.</p>

        <h3>5. Children’s Privacy</h3>
        <p>Our app is not intended for children under the age of 13. We do not knowingly collect personal information from children.</p>

        <h3>6. Changes to This Privacy Statement</h3>
        <p>We may update this Privacy Statement from time to time. When we do, we will revise the “Last Updated” date and notify you of significant changes.</p>

        <h3>7. Contact Us</h3>
        <p>If you have questions or concerns about this Privacy Statement or your data, please contact our support team through the <strong>Contact Support</strong> option in the app.</p>
      </article>
    </section>
  </div>;
}

export function ContactSupportPopup({ onClose }) {
  const [status, setStatus] = useState('');
  function submit(event) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    const subject = String(form.get('subject') || '').trim();
    const name = String(form.get('name') || '').trim();
    const message = String(form.get('message') || '').trim();
    if (!subject || !name || !message) {
      setStatus('Please add a subject, your name, and a message.');
      return;
    }
    const supportRecipient = 'network.creation@outlook.com';
    const mailSubject = `SAGE support request: ${subject}`;
    const mailBody = `From: ${name}\n\nSubject: ${subject}\n\nMessage:\n${message}`;
    const mailtoUrl = `mailto:${encodeURIComponent(supportRecipient)}?subject=${encodeURIComponent(mailSubject)}&body=${encodeURIComponent(mailBody)}`;
    window.open(mailtoUrl, '_blank', 'noopener,noreferrer');
    // Clear the form fields and close Contact Support after submitting.
    try { formEl.reset(); } catch (_) {}
    onClose();
  }
  return <div className="settings-modal-backdrop contact-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="settings-modal contact-modal" role="dialog" aria-modal="true" aria-label="Contact Support">
      <div className="settings-modal-gradient-header contact-header"><MessageCircle size={24}/><h2>Contact Support</h2><button type="button" onClick={onClose} aria-label="Close contact support"><X size={18}/></button></div>
      <form className="support-form" onSubmit={submit}>
        <label>Subject<input name="subject" placeholder="Brief description of your issue..." /></label>
        <label>Your Name<span className="input-with-icon"><Mail size={17}/><input name="name" type="text" autoComplete="name" placeholder="Your name..." /></span></label>
        <label>Message<textarea name="message" placeholder="Please describe your issue in detail..." /></label>
        {status && <p className="settings-form-status support-status" role="status" aria-live="polite">{status}</p>}
        <div className="modal-button-row support-actions"><button type="button" className="support-cancel" onClick={onClose}>Cancel</button><button type="submit" className="support-submit"><Send size={18}/> Send Message</button></div>
      </form>
    </section>
  </div>;
}

export function PremiumMembershipPopup({ onClose }) {
  const [amount, setAmount] = useState('10');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('');
  const [processing, setProcessing] = useState(false);
  const [paid, setPaid] = useState(false);
  const [stripeReady, setStripeReady] = useState(false);
  const [cardBrand, setCardBrand] = useState('Credit Card');
  const [numberState, setNumberState] = useState('empty');
  const [expiryState, setExpiryState] = useState('empty');
  const [cvvState, setCvvState] = useState('empty');
  const stripeRef = useRef(null);
  const elementsRef = useRef(null);
  const cardNumberElRef = useRef(null);
  const cardExpiryElRef = useRef(null);
  const cardCvcElRef = useRef(null);
  const mountedRef = useRef(false);

  const fieldLabel = { correct: 'Correct', incorrect: 'Invalid', incomplete: 'Incomplete', empty: '' };

  useEffect(() => {
    mountedRef.current = true;
    let destroyed = false;
    async function loadStripe() {
      if (!window.Stripe) {
        await new Promise((resolve, reject) => {
          const existing = document.querySelector('script[src="https://js.stripe.com/v3/"]');
          if (existing) { existing.addEventListener('load', resolve, { once: true }); existing.addEventListener('error', reject, { once: true }); return; }
          const script = document.createElement('script');
          script.src = 'https://js.stripe.com/v3/';
          script.async = true; script.onload = resolve; script.onerror = reject;
          document.head.appendChild(script);
        });
      }
      const response = await fetch(`${FUNCTIONS_BASE}/stripeConfig`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok || !result.publishable_key) throw new Error(result.error || 'Stripe is not configured.');
      if (destroyed || !mountedRef.current) return;
      const stripe = window.Stripe(result.publishable_key);
      stripeRef.current = stripe;
      const elementStyle = {
        base: {
          fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
          fontSize: '16px',
          fontWeight: '650',
          color: '#1e2233',
          '::placeholder': { color: '#a4a9c2', fontWeight: '600' },
        },
        invalid: { color: '#dc2626', iconColor: '#dc2626' },
      };
      const elements = stripe.elements();
      elementsRef.current = elements;
      const cardNumber = elements.create('cardNumber', { style: elementStyle, placeholder: '1234 5678 9012 3456', showIcon: false });
      const cardExpiry = elements.create('cardExpiry', { style: elementStyle, placeholder: 'MM / YY' });
      const cardCvc = elements.create('cardCvc', { style: elementStyle, placeholder: 'CVV' });
      cardNumber.mount('#sir-el-number');
      cardExpiry.mount('#sir-el-exp');
      cardCvc.mount('#sir-el-cvc');
      cardNumberElRef.current = cardNumber;
      cardExpiryElRef.current = cardExpiry;
      cardCvcElRef.current = cardCvc;
      const brandMap = { visa: 'VISA', mastercard: 'MASTERCARD', amex: 'AMEX', discover: 'DISCOVER', diners: 'DINERS', jcb: 'JCB', unionpay: 'UNIONPAY' };
      const stateFrom = (ev) => ev.empty ? 'empty' : ev.error ? 'incorrect' : ev.complete ? 'correct' : 'incomplete';
      cardNumber.on('change', (ev) => {
        setNumberState(stateFrom(ev));
        setCardBrand(ev.brand && ev.brand !== 'unknown' ? (brandMap[ev.brand] || 'Credit Card') : 'Credit Card');
      });
      cardExpiry.on('change', (ev) => setExpiryState(stateFrom(ev)));
      cardCvc.on('change', (ev) => setCvvState(stateFrom(ev)));
      setStripeReady(true);
    }
    loadStripe().catch(error => { if (!destroyed) setStatus(error.message || 'Payment service could not load.'); });
    return () => {
      destroyed = true; mountedRef.current = false;
      try { cardNumberElRef.current?.destroy(); cardExpiryElRef.current?.destroy(); cardCvcElRef.current?.destroy(); } catch (_) {}
    };
  }, []);

  const amountNum = Number(amount);
  const amountValid = Number.isFinite(amountNum) && amountNum >= 1 && amountNum <= 10000;
  const allValid = numberState === 'correct' && expiryState === 'correct' && cvvState === 'correct';

  async function submit(event) {
    event.preventDefault();
    if (processing) return;
    const donationAmount = Number(amount);
    setStatus('');
    if (!donationAmount || donationAmount < 1) return setStatus('Please enter a valid donation amount.');
    if (donationAmount > 10000) return setStatus('Please choose a donation amount under $10,000.');
    if (!name || name.trim().length < 2) return setStatus('Please enter the cardholder name.');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setStatus('Please enter a valid email address for the receipt.');
    if (!stripeRef.current || !stripeReady) return setStatus('Payment service is still loading. Please try again in a moment.');
    if (!allValid) return setStatus('Please complete the card details.');

    setProcessing(true);
    setStatus('Creating a secure payment...');
    try {
      const intentRes = await fetch(`${FUNCTIONS_BASE}/stripePremiumPaymentIntent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: donationAmount, email: email.trim(), name: name.trim() }),
      });
      const intent = await intentRes.json().catch(() => ({}));
      if (!intentRes.ok || !intent.ok || !intent.client_secret) {
        setStatus(intent.error || 'Could not start the payment. Please try again.');
        setProcessing(false);
        return;
      }
      setStatus('Processing your payment securely with Stripe...');
      const confirmation = await stripeRef.current.confirmCardPayment(intent.client_secret, {
        payment_method: {
          card: cardNumberElRef.current,
          billing_details: { name: name.trim(), email: email.trim() },
        },
        receipt_email: email.trim(),
      });
      if (confirmation.error || confirmation.paymentIntent?.status !== 'succeeded') {
        setStatus(confirmation.error?.message || 'Payment could not be completed. Please check the card details.');
        setProcessing(false);
        return;
      }
      const pi = confirmation.paymentIntent;
      const premiumRecord = {
        premium: true,
        provider: 'stripe-elements',
        email: email.trim(),
        name: name.trim(),
        amount: typeof pi.amount === 'number' ? pi.amount / 100 : donationAmount,
        currency: pi.currency || 'usd',
        paymentIntent: pi.id || intent.payment_intent || '',
        activatedAt: new Date().toISOString(),
      };
      localStorage.setItem('sirPremiumUser', JSON.stringify(premiumRecord));
      // Clear the card form after a successful payment
      try { cardNumberElRef.current?.clear(); cardExpiryElRef.current?.clear(); cardCvcElRef.current?.clear(); } catch (_) {}
      setNumberState('empty'); setExpiryState('empty'); setCvvState('empty'); setCardBrand('Credit Card');
      setStatus('Payment confirmed. Thank you!');
      setProcessing(false);
      setPaid(true);
      setTimeout(() => { if (mountedRef.current) onClose(); }, 2500);
    } catch (_) {
      setStatus('Payment service is unavailable right now. Please try again shortly.');
      setProcessing(false);
    }
  }

  return <div className="settings-modal-backdrop premium-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="settings-modal premium-modal" role="dialog" aria-modal="true" aria-label="Upgrade and Support">
      <div className="premium-header"><div><h2><Heart size={22}/> Support This App</h2><p>Show your love to become a premium supporter.</p></div><button type="button" onClick={onClose} aria-label="Close upgrade and support"><X size={18}/></button></div>
      <form className="premium-form" onSubmit={submit} noValidate autoComplete="on">
        <label className="payment-label">Donation Amount (USD)</label>
        <div className="amount-grid">{['5','10','25','50'].map(value => <button key={value} type="button" className={amount === value ? 'selected' : ''} onClick={() => setAmount(value)}>${value}</button>)}</div>
        <input name="customAmount" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value.replace(/[^\d.]/g, '').slice(0, 8))} aria-label="Custom donation amount" />
        <label className="payment-label">Payment Information</label>
        <input name="ccname" id="sir-cc-name" autoComplete="cc-name" placeholder="Cardholder Name" value={name} onChange={event => setName(event.target.value)} />
        <span className="input-with-icon premium-email"><Mail size={17}/><input name="email" type="email" autoComplete="email" placeholder="Your email address" value={email} onChange={event => setEmail(event.target.value)} /></span>
        <div className="classic-card-fields">
          <div className={`classic-card-field native ${numberState}`}>
            <div id="sir-el-number" className="classic-card-input native-card-input stripe-el-input" aria-label="Credit card number" />
            <span className="card-brand-tag">{cardBrand}</span>
            {numberState !== 'empty' && <em className={`native-field-validation ${numberState}`}>{fieldLabel[numberState]}</em>}
          </div>
          <div className="classic-card-row">
            <div className={`classic-card-field native ${expiryState}`}>
              <div id="sir-el-exp" className="classic-card-input native-card-input stripe-el-input" aria-label="Expiration date" />
              {expiryState !== 'empty' && <em className={`native-field-validation ${expiryState}`}>{fieldLabel[expiryState]}</em>}
            </div>
            <div className={`classic-card-field native ${cvvState}`}>
              <div id="sir-el-cvc" className="classic-card-input native-card-input stripe-el-input" aria-label="CVV" />
              {cvvState !== 'empty' && <em className={`native-field-validation ${cvvState}`}>{fieldLabel[cvvState]}</em>}
            </div>
          </div>
          <p className={`secured-encrypted-note${status ? ' as-status' : ''}${paid ? ' as-success' : ''}`} role="status" aria-live="polite"><ShieldCheck size={15}/><span>{status || 'Your payment information is secured and encrypted.'}</span></p>
        </div>
        <div className="modal-button-row premium-actions"><button type="button" className="premium-cancel" onClick={onClose}>Cancel</button><button type="submit" className="donate-submit" disabled={processing || paid || !stripeReady || !allValid || !amountValid}><Heart size={18}/> {paid ? 'Thank you!' : processing ? 'Processing...' : `Donate $${amount || '0'}`}</button></div>
      </form>
    </section>
  </div>;
}