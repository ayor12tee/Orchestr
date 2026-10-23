-- =============================================================================
-- Initial planning baseline for ConTech Nigeria 2026 (brief §2.1, §7)
--
-- Safe to rerun: existing rows are left untouched, so edits made in the app
-- are never overwritten. Every seeded task is source = 'seed' and
-- planning_state = 'suggested'. That means it's a proposal, not proof that
-- work has been assigned or done. No owners, deadlines, durations, targets or
-- figures are seeded; leadership confirms those in the app.
-- =============================================================================

insert into public.conferences (id, slug, name, event_date, venue, theme)
values ('c0de2026-0000-4000-8000-000000000001', 'contech-nigeria-2026', 'ConTech Nigeria 2026 Conference',
        '2026-11-21', 'Regal Hall, Ikeja, Lagos',
        'Creating the Nigerian Playbook: Local Solutions, Global Standards')
on conflict (id) do nothing;

insert into public.conference_settings (conference_id, key, value, approval_state) values
  -- Confirmed by leadership on 2026-10-16.
  ('c0de2026-0000-4000-8000-000000000001', 'date_convention', '{"days": "calendar", "due_dates_inclusive": true}', 'approved'),
  ('c0de2026-0000-4000-8000-000000000001', 'notifications', '{"email": "supabase_smtp", "in_app": true}', 'approved'),
  -- Proposed default. Unverified "completed" work earns no progress credit.
  ('c0de2026-0000-4000-8000-000000000001', 'progress', '{"unverified_complete_credit": 0}', 'suggested'),
  -- Proposed default for the "Due soon" indicator. Leadership can change it.
  ('c0de2026-0000-4000-8000-000000000001', 'indicators', '{"due_soon_days": 7}', 'suggested')
on conflict (conference_id, key) do nothing;

insert into public.departments (conference_id, slug, name, sort_order, source)
select 'c0de2026-0000-4000-8000-000000000001', slug, name, ord, 'seed'
from (values
  (1,  'leadership',          'Leadership and conference coordination'),
  (2,  'sponsorship',         'Sponsorship and strategic partnerships'),
  (3,  'exhibitors',          'Exhibitors and business partners'),
  (4,  'speakers-programme',  'Speakers and programme'),
  (5,  'finance',             'Finance and revenue'),
  (6,  'venue-logistics',     'Venue and logistics'),
  (7,  'design',              'Design and creative production'),
  (8,  'video-content',       'Video and content production'),
  (9,  'marketing',           'Marketing and registration'),
  (10, 'volunteers',          'Volunteer coordination'),
  (11, 'technical-ops',       'Technical production and event-day operations'),
  (12, 'attendee-experience', 'Attendee experience and registration operations'),
  (13, 'risk-safety',         'Risk, safety and contingency planning'),
  (14, 'closeout',            'Post-event reporting and closeout')
) as w(ord, slug, name)
on conflict (conference_id, slug) do nothing;

insert into public.tasks (conference_id, department_id, workstream, title, source, seed_key, planning_state, requires_evidence, requires_review)
select 'c0de2026-0000-4000-8000-000000000001', d.id, d.name, t.title, 'seed', t.seed_key, 'suggested', t.evidence, t.review
from (values
  -- Sponsorship and partnerships
  ('sponsorship', 'sp-01', 'Validate the prospect list', false, false),
  ('sponsorship', 'sp-02', 'Identify priority sponsor and partner targets', false, false),
  ('sponsorship', 'sp-03', 'Assign relationship owners', false, false),
  ('sponsorship', 'sp-04', 'Prepare tailored outreach materials', false, true),
  ('sponsorship', 'sp-05', 'Publish approved sponsorship and partnership calls', true, true),
  ('sponsorship', 'sp-06', 'Send initial outreach', false, false),
  ('sponsorship', 'sp-07', 'Schedule follow-ups', false, false),
  ('sponsorship', 'sp-08', 'Track meetings and proposals', false, false),
  ('sponsorship', 'sp-09', 'Record commitments and evidence', true, false),
  ('sponsorship', 'sp-10', 'Track sponsor benefits and delivery requirements', false, false),
  -- Speakers and programme
  ('speakers-programme', 'pg-01', 'Review the programme and remaining speaker gaps', false, false),
  ('speakers-programme', 'pg-02', 'Identify prospective speakers', false, false),
  ('speakers-programme', 'pg-03', 'Assign outreach owners', false, false),
  ('speakers-programme', 'pg-04', 'Send invitations', false, false),
  ('speakers-programme', 'pg-05', 'Track follow-ups and confirmations', true, false),
  ('speakers-programme', 'pg-06', 'Collect biographies, headshots and session information', false, false),
  ('speakers-programme', 'pg-07', 'Confirm session owners and programme timings', false, true),
  ('speakers-programme', 'pg-08', 'Prepare speaker publicity assets', false, true),
  ('speakers-programme', 'pg-09', 'Collect presentations and technical requirements', false, false),
  -- Finance
  ('finance', 'fi-01', 'Review the approved budget', false, false),
  ('finance', 'fi-02', 'Identify funding gaps', false, false),
  ('finance', 'fi-03', 'Track sponsor and exhibitor revenue', false, false),
  ('finance', 'fi-04', 'Track approved expenses and obligations', false, false),
  ('finance', 'fi-05', 'Follow up on outstanding commitments', false, false),
  ('finance', 'fi-06', 'Monitor invoices, payments and cash received', true, false),
  ('finance', 'fi-07', 'Escalate financial risks to authorised leadership', false, false),
  -- Design and content
  ('design', 'ds-01', 'Validate the creative deliverables list', false, false),
  ('design', 'ds-02', 'Assign the pending design requests', false, false),
  ('design', 'ds-03', 'Produce speaker graphics', true, true),
  ('design', 'ds-04', 'Prepare approved advertising creatives', true, true),
  ('design', 'ds-05', 'Create content track graphics', true, true),
  ('design', 'ds-06', 'Complete the event-day programme design', true, true),
  ('design', 'ds-07', 'Review, revise and approve assets', false, true),
  ('design', 'ds-08', 'Record final publication or delivery evidence', true, false),
  -- The four video deliverables are separate assets (brief §5 I).
  ('video-content', 'vd-01', 'Video: landscape highlight, without voice-over', true, true),
  ('video-content', 'vd-02', 'Video: landscape highlight, with voice-over', true, true),
  ('video-content', 'vd-03', 'Video: portrait, without voice-over', true, true),
  ('video-content', 'vd-04', 'Video: portrait, with voice-over', true, true),
  -- Marketing and registration
  ('marketing', 'mk-01', 'Confirm registration and attendance targets', false, true),
  ('marketing', 'mk-02', 'Build the content and publication calendar', false, false),
  ('marketing', 'mk-03', 'Coordinate campaign dependencies', false, false),
  ('marketing', 'mk-04', 'Publish approved campaigns', true, true),
  ('marketing', 'mk-05', 'Track verified registrations', true, false),
  ('marketing', 'mk-06', 'Monitor campaign performance', false, false),
  ('marketing', 'mk-07', 'Escalate underperforming campaigns using approved thresholds', false, false),
  -- Logistics and event-day operations
  ('venue-logistics', 'lg-01', 'Validate venue and supplier requirements', false, false),
  ('venue-logistics', 'lg-02', 'Confirm required equipment and services', true, false),
  ('venue-logistics', 'lg-03', 'Develop the setup plan', false, true),
  ('technical-ops',   'op-01', 'Prepare the run sheet', false, true),
  ('technical-ops',   'op-02', 'Assign event-day responsibilities', false, false),
  ('technical-ops',   'op-03', 'Conduct relevant rehearsals and checks', true, false),
  ('risk-safety',     'rk-01', 'Validate contingency arrangements', false, true),
  ('leadership',      'ld-09', 'Confirm operational readiness', true, true),
  -- Coordination
  ('leadership', 'ld-01', 'Establish department objectives', false, true),
  ('leadership', 'ld-02', 'Confirm accountable owners', false, false),
  ('leadership', 'ld-03', 'Set and approve deadlines', false, false),
  ('leadership', 'ld-04', 'Resolve cross-department dependencies', false, false),
  ('leadership', 'ld-05', 'Review blockers and overdue work', false, false),
  ('leadership', 'ld-06', 'Run weekly planning and progress reviews', false, false),
  ('leadership', 'ld-07', 'Record decisions and actions', false, false),
  ('leadership', 'ld-08', 'Escalate unresolved risks', false, false)
) as t(dept_slug, seed_key, title, evidence, review)
join public.departments d
  on d.conference_id = 'c0de2026-0000-4000-8000-000000000001' and d.slug = t.dept_slug
on conflict (conference_id, seed_key) do nothing;
