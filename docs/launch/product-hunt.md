# DayBoard Product Hunt launch plan

Launch DayBoard 1.0 on Product Hunt once five gates are green; run the free beta by email invite until then.

## Recommendation

- **Launch 1.0 on Product Hunt, not the beta.** Product Hunt allows a relaunch only after a major update, about 6 months later. Launch-day visitors must be able to download, open DayBoard without a security warning, sign in with Google, and (if 1.0 is paid) buy it. The beta can't do any of those yet.
- **Until then, run the private beta** through the website's signup list. Invite testers in small batches, fix what they find, and collect quotes you may use at launch.
- **Launch day:** a Tuesday–Thursday gives the most traffic and the most competition; a weekend is easier to rank on, and Product Hunt reports about 15% more "Visit" clicks on weekends. For a first indie launch, favor Saturday or Sunday unless your audience is already large. Go live at 12:01 AM Pacific.

## Gates (all required before scheduling)

| Gate                               | Why it blocks launch                                                                                                                                                                                                                                    | Owner                    | Lead time                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------ |
| **Google OAuth verification**      | The consent screen is in **Testing**: only listed test users can sign in (100 max), and they must sign in again every 7 days. Published but unverified, every visitor sees "Google hasn't verified this app" and sign-ups stop at 100 users.            | Miles                    | Brand verification 2–3 business days; sensitive scopes days to weeks; restricted scope "several weeks" |
| **Gmail decision**                 | `gmail.modify` is a **restricted** scope: verification plus a paid third-party security assessment (CASA), renewed every 12 months. Calendar (`calendar.events`, `calendar.calendarlist.readonly`) and `tasks` are sensitive scopes: verification only. | Miles                    | Assessment quote and scheduling                                                                        |
| **Notarized build**                | Without Developer ID signing and notarization, every new user hits the "Open Anyway" flow. PR #8's release workflow automates this once secrets exist.                                                                                                  | Miles (Apple enrollment) | Enrollment + secrets                                                                                   |
| **Purchase path** (if 1.0 is paid) | Price, activation limit, live Stripe product, deployed license service, refund and support policy.                                                                                                                                                      | Miles                    | After pricing                                                                                          |
| **Website live**                   | Domain, hosting, signup endpoint, **privacy policy page** (Google verification requires one that discloses Limited Use), support contact, absolute `og:image`.                                                                                          | Miles + agent            | Days once hosting is chosen                                                                            |

Google's verification needs: a verified domain homepage, the privacy policy linked on the consent screen, and a demo video of the OAuth flow showing the app name, the client ID in the address bar, and each scope's feature. If Gmail waits, ship 1.0 with Calendar, Tasks and Reminders and add Gmail when its review is done.

## Timeline (from the day all gates are green, "L")

| When         | Work                                                                                                                                                                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Now → gates  | Private beta by invite (≤100 Google test users). Weekly builds. Feedback via GitHub Issues. Collect quotes with permission. Set up your Product Hunt maker profile and take part in the community (comment on other launches). Share progress on X, Bluesky or Mastodon. |
| L − 6 weeks  | Pick the launch window. Start the assets below. Decide on a launch offer.                                                                                                                                                                                                |
| L − 4 weeks  | Finish the gallery, thumbnail, video, tagline, description and first comment. Schedule the launch (Product Hunt allows up to one month ahead).                                                                                                                           |
| L − 2 weeks  | Full dry run on a clean Mac: download → open → Google sign-in → purchase → activation. Prepare the beta-list email and social posts.                                                                                                                                     |
| L − 1 week   | Tell beta testers the date and ask for honest feedback on the page, never upvotes. Freeze features and keep a hotfix path ready.                                                                                                                                         |
| Launch day   | 12:01 AM PT: launch goes live; post the maker comment right away. Email the list, post on socials, show a "Live on Product Hunt" banner on the site. Reply to every comment for 24 hours. Watch downloads, sign-ins, crashes and Stripe.                                 |
| L + 1 week   | Thank supporters. Post Show HN on a separate day (open source, local-first angle). Pitch Mac sites' tip lines. Add a Product Hunt badge to the site if you ranked. Write a retro.                                                                                        |
| L + 6 months | Eligible to relaunch with a major update (for example, Gmail or an iPhone companion).                                                                                                                                                                                    |

## Launch assets

| Asset                         | Spec                                                                                 | Source                                                                                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Thumbnail                     | 240×240, under 3 MB (GIF allowed)                                                    | App icon. The current speedometer icon reads as a system monitor; consider a refresh before launch.                                                                                             |
| Gallery                       | 5–7 images at 1270×760                                                               | From `docs/screenshots/`, framed in the website's style: board overview, four sources into one agenda, calendar, linked tasks and reminders, inbox, assistant and MCP, privacy and open source. |
| Video (optional, recommended) | 60–90 s, YouTube, no talking head                                                    | Problem → one board → calendar → linking → inbox → optional AI → privacy and open source → call to action. Record from demo mode.                                                               |
| Tagline                       | ≤60 characters                                                                       | "Google Calendar, Tasks, Reminders & Gmail in one Mac app" (56) or "Your whole day, on one board" (28)                                                                                          |
| Description                   | ≤500 characters                                                                      | Draft below.                                                                                                                                                                                    |
| Maker's first comment         | The most-read text on the page; 70% of Product of the Day/Week/Month winners had one | Draft below. Rewrite it in your own words.                                                                                                                                                      |
| Topics                        | 3–4                                                                                  | Productivity, Mac, Task Management, Open Source (confirm names when submitting).                                                                                                                |

**Description draft (≤500):**
DayBoard brings Google Calendar, Google Tasks, Apple Reminders and Gmail into one calm Mac app. See today's events and to-dos in a single agenda, spot a crowded week in month and week views, link a task that lives in both Google Tasks and Apple Reminders, and read mail next to your plans. An optional assistant works with the Claude or ChatGPT account you already have. Your data stays between your Mac, Google and Apple. Open source under GPL-3.0.

**First comment draft:**
Hi Product Hunt! I built DayBoard because my day was split across four apps: Google Calendar for meetings, Google Tasks for work, Apple Reminders for errands, and Gmail for everything else. Planning a day meant checking all four. DayBoard puts them on one board, in time order, and keeps every change in sync with Google and Apple. It's a native-feeling Mac app, the AI is optional and uses accounts you already have, and there's no DayBoard server that sees your data. The source is open under GPL-3.0; the signed build is how I fund the work. I'd love your feedback: what's missing from your daily setup?

## Channels

- **Owned:** the beta email list (needs a sending tool; the signup service only stores addresses), the website, GitHub README and release notes, your social accounts.
- **Communities:** Mac and productivity subreddits and Indie Hackers. Read each community's self-promotion rules before posting, and take part before you promote. Some forbid promotion outright.
- **Hacker News:** Show HN on a different day from Product Hunt.
- **Press:** tip lines of Mac-focused sites and newsletters, with the gallery and a download link.
- **Never ask for upvotes** anywhere. Ask people to take a look and share feedback.

## Metrics

- **Primary:** launch-week activations: installs that complete Google sign-in or add a source. If 1.0 is paid, also purchases.
- **Secondary:** site visits, beta and launch signups, downloads, GitHub stars, feedback items, Product Hunt rank (a vanity metric).
- **Tracking:** privacy-friendly site analytics without cookies, the signup table, Stripe, GitHub.

## Risks

| Risk                                          | Mitigation                                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------------- |
| Google sign-in capped or warned on launch day | Verification is a hard gate; don't schedule until it's done.                 |
| Gatekeeper warning scares visitors off        | Notarization is a hard gate.                                                 |
| "Another Electron app" criticism              | Measure launch time and memory on the release build and answer with numbers. |
| Confusion about paid plus open source         | Plain FAQ: the source is free under GPL; the signed build funds the work.    |
| Community bans for self-promotion             | Follow each community's rules; participate first.                            |
| Launch-day bugs                               | Feature freeze a week out; hotfix through the release workflow.              |

## Costs

No paid ads planned. Known costs: Apple Developer Program ($99/year), a CASA assessment if Gmail ships at launch (get quotes), a domain, and optionally an email sending tool.

## Decisions for Miles

1. Launch 1.0 (recommended) or the free beta.
2. Gmail at launch with CASA, or ship Calendar, Tasks and Reminders first.
3. Weekday or weekend launch.
4. Launch offer (needs pricing).
5. Email sending tool for the list.
