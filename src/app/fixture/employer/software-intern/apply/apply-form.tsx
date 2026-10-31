"use client";
import { useEffect, useState } from "react";
export function FixtureApplyForm({ initialApplicationId }: { initialApplicationId: string }) {
  const [sponsorship, setSponsorship] = useState(""),
    [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return (
    <form
      action="/api/fixture/apply"
      method="POST"
      encType="multipart/form-data"
      className="card"
      data-testid="fixture-application"
      data-ready={ready}
    >
      <input type="hidden" name="external_application_id" defaultValue={initialApplicationId} />
      <div className="form-grid">
        <label className="field">
          <span>First name</span>
          <input
            className="input"
            name="first_name"
            autoComplete="given-name"
            required
            maxLength={100}
          />
        </label>
        <label className="field">
          <span>Last name</span>
          <input
            className="input"
            name="last_name"
            autoComplete="family-name"
            required
            maxLength={150}
          />
        </label>
      </div>
      <label className="field">
        <span>Email address</span>
        <input className="input" name="email" type="email" autoComplete="email" required />
      </label>
      <label className="field">
        <span>Phone number</span>
        <input
          className="input"
          name="phone"
          type="tel"
          autoComplete="tel"
          required
          maxLength={50}
        />
      </label>
      <label className="field">
        <span>Location</span>
        <input
          className="input"
          name="location"
          autoComplete="address-level2"
          required
          maxLength={250}
        />
      </label>
      <label className="field">
        <span>Are you legally authorized to work in the United States?</span>
        <select className="input" name="work_authorization" required defaultValue="">
          <option value="">Choose an answer</option>
          <option value="yes">yes</option>
          <option value="no">no</option>
        </select>
      </label>
      <label className="field">
        <span>Will you require employer sponsorship?</span>
        <select
          className="input"
          name="sponsorship"
          required
          value={sponsorship}
          onChange={(e) => setSponsorship(e.target.value)}
        >
          <option value="">Choose an answer</option>
          <option value="yes">yes</option>
          <option value="no">no</option>
        </select>
      </label>
      <label
        className="field"
        hidden={sponsorship !== "yes"}
        style={{ display: sponsorship === "yes" ? "flex" : "none" }}
      >
        <span>Please describe the sponsorship you need</span>
        <textarea
          className="input"
          name="sponsorship_details"
          required={sponsorship === "yes"}
          maxLength={4000}
          rows={3}
        />
      </label>
      <label className="field">
        <span>Portfolio or personal website (optional)</span>
        <input className="input" name="portfolio" type="url" maxLength={2000} />
      </label>
      <label className="field">
        <span>Resume (PDF)</span>
        <input className="input" name="resume" type="file" accept="application/pdf,.pdf" required />
      </label>
      <p className="helper-text">
        Submitting records a local test receipt. It does not contact a real employer.
      </p>
      <button className="button button-primary" type="submit">
        Submit application
      </button>
    </form>
  );
}
