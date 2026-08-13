// src/pages/TermsOfService.tsx
//
// Public, unauthenticated page. Mirrors docs/TERMS_OF_SERVICE.md — edit
// this file directly to change what guests/staff see; keep the .md copy
// in sync if you want a plain-text version for lawyers to review outside
// the app.

import { Link } from "@tanstack/react-router";
import { useHotelDetails } from "@/contexts/HotelDetailsContext";

const LAST_UPDATED = "2026-08-13"; // bump whenever the text below changes

function LegalShell({
  title,
  hotelName,
  children,
}: {
  title: string;
  hotelName: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <Link to="/login" className="text-sm text-muted-foreground hover:underline">
          &larr; Back
        </Link>
        <h1 className="mt-4 text-3xl font-bold">
          {title} — {hotelName || "[HOTEL NAME]"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Last updated: {LAST_UPDATED}. Draft prepared for legal review — not
          final until approved by qualified counsel.
        </p>
        <div className="prose prose-sm mt-8 max-w-none dark:prose-invert">
          {children}
        </div>
      </div>
    </div>
  );
}

export default function TermsOfService() {
  const { details } = useHotelDetails();
  const hotelName = details.hotelName;

  return (
    <LegalShell title="Terms of Service" hotelName={hotelName}>
      <h2>1. Acceptance</h2>
      <p>
        By booking a stay or checking in at {hotelName || "[HOTEL NAME]"},
        you agree to these Terms.
      </p>

      <h2>2. Booking &amp; check-in</h2>
      <ul>
        <li>
          A valid government-issued ID / passport is required at check-in,
          as required by local hotel-registration law.
        </li>
        <li>
          Room categories, rates, and availability shown in our system are
          subject to change until a booking is confirmed by staff.
        </li>
        <li>
          Check-in/check-out times: standard check-in [TIME], standard
          check-out [TIME]. Early check-in / late check-out are subject to
          availability and may incur an additional charge, shown at time of
          booking.
        </li>
      </ul>

      <h2>3. Payment</h2>
      <p>
        Rates are shown in [CURRENCY — e.g. сумм/UZS] and are due as agreed
        at booking or check-in. Accepted payment types: cash, card, bank
        transfer (as offered at your property).{" "}
        <em>
          (Fill in with your actual accepted methods and any deposit /
          cancellation-fee policy.)
        </em>
      </p>

      <h2>4. Cancellation &amp; no-show policy</h2>
      <p>
        <em>
          [Fill in: cancellation window, refund policy, no-show charge if
          any.]
        </em>
      </p>

      <h2>5. Guest conduct</h2>
      <p>
        Guests must comply with hotel rules, applicable law, and reasonable
        staff instructions. The Hotel reserves the right to refuse service
        or end a stay in cases of illegal activity, damage to property, or
        serious disruption to other guests.
      </p>

      <h2>6. Liability</h2>
      <p>
        <em>
          This section needs your lawyer — typical hotel Terms limit
          liability for guest belongings except where required by law, and
          disclaim liability for matters outside the Hotel's control. Do not
          publish generic limitation-of-liability language without local
          legal review, as enforceability varies by jurisdiction.
        </em>
      </p>

      <h2>7. Data protection</h2>
      <p>
        Your personal data is handled as described in our{" "}
        <Link to="/privacy">Privacy Policy</Link>.
      </p>

      <h2>8. Changes to these Terms</h2>
      <p>
        We may update these Terms from time to time; the "Last updated" date
        above reflects the latest revision.
      </p>

      <h2>9. Governing law</h2>
      <p>
        These Terms are governed by the laws of [JURISDICTION — e.g.
        Republic of Uzbekistan]. <em>(Confirm with your lawyer.)</em>
      </p>

      <h2>10. Contact</h2>
      <p>Questions about these Terms: [EMAIL / PHONE / ADDRESS]</p>

      <hr />
      <p className="text-xs text-muted-foreground">
        This is a starting draft, not a finished legal document. Sections
        marked "fill in" or "needs your lawyer" must be completed with your
        actual policies and reviewed by qualified counsel before relying on
        it.
      </p>
    </LegalShell>
  );
}
