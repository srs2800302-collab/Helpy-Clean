-- Integrity indexes only. Product policy and catalog are not migration data.
CREATE TABLE repository_meta (
 id TEXT PRIMARY KEY CHECK(id='core'), revision INTEGER NOT NULL CHECK(revision>=0 AND revision<=9007199254740991),
 codec_version INTEGER NOT NULL CHECK(codec_version>0), commit_token TEXT
) STRICT;
INSERT INTO repository_meta VALUES ('core',0,1,NULL);
CREATE TABLE operation_receipts (
 operation_id TEXT NOT NULL, chunk_index INTEGER NOT NULL CHECK(chunk_index>=0), actor_id TEXT NOT NULL,
 signature TEXT NOT NULL, chunk_count INTEGER NOT NULL CHECK(chunk_count>0), payload_chunk TEXT NOT NULL,
 codec_version INTEGER NOT NULL CHECK(codec_version>0), PRIMARY KEY(operation_id,chunk_index),
 CHECK(chunk_index<chunk_count)
) STRICT;
CREATE TABLE users (
 user_id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, email TEXT UNIQUE, phone TEXT UNIQUE,
 display_name TEXT NOT NULL, photo_id TEXT, locale TEXT NOT NULL,
 client_active INTEGER NOT NULL CHECK(client_active IN(0,1)), master_active INTEGER NOT NULL CHECK(master_active IN(0,1)),
 specialization_payload TEXT NOT NULL, contacts_payload TEXT NOT NULL
) STRICT;
CREATE TABLE user_identities (
 method TEXT NOT NULL, subject TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(user_id),
 position INTEGER NOT NULL CHECK(position>=0), PRIMARY KEY(method,subject), UNIQUE(user_id,position)
) STRICT;
CREATE TABLE consumed_claims (claim_id TEXT PRIMARY KEY, purpose TEXT NOT NULL CHECK(purpose IN('login','bind','recover'))) STRICT;
CREATE TABLE catalog_revisions (
 catalog_key TEXT PRIMARY KEY, catalog_id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>0),
 sequence INTEGER NOT NULL CHECK(sequence>0), status TEXT NOT NULL CHECK(status IN('draft','published')),
 is_current INTEGER NOT NULL CHECK(is_current IN(0,1)), UNIQUE(catalog_id,version), CHECK(is_current=0 OR status='published')
) STRICT;
CREATE UNIQUE INDEX one_current_catalog ON catalog_revisions(is_current) WHERE is_current=1;
CREATE TABLE catalog_texts (
 catalog_key TEXT NOT NULL REFERENCES catalog_revisions(catalog_key), text_id TEXT NOT NULL,
 position INTEGER NOT NULL CHECK(position>=0), revision INTEGER NOT NULL CHECK(revision>0),
 meaning INTEGER NOT NULL CHECK(meaning>0), editions_payload TEXT NOT NULL,
 PRIMARY KEY(catalog_key,text_id), UNIQUE(catalog_key,position)
) STRICT;
CREATE TABLE catalog_items (
 catalog_key TEXT NOT NULL REFERENCES catalog_revisions(catalog_key),
 item_type TEXT NOT NULL CHECK(item_type IN('category','entity','scenario','block','binding')), item_id TEXT NOT NULL,
 position INTEGER NOT NULL CHECK(position>=0), payload TEXT NOT NULL,
 PRIMARY KEY(catalog_key,item_type,item_id), UNIQUE(catalog_key,item_type,position)
) STRICT;
CREATE TABLE policies (
 version TEXT PRIMARY KEY, position INTEGER NOT NULL UNIQUE CHECK(position>=0), effective_at INTEGER NOT NULL UNIQUE, policy_payload TEXT NOT NULL
) STRICT;
CREATE TABLE translation_corrections (
 old_catalog_key TEXT NOT NULL, text_id TEXT NOT NULL, new_catalog_key TEXT NOT NULL,
 PRIMARY KEY(old_catalog_key,text_id),
 FOREIGN KEY(old_catalog_key,text_id) REFERENCES catalog_texts(catalog_key,text_id),
 FOREIGN KEY(new_catalog_key,text_id) REFERENCES catalog_texts(catalog_key,text_id)
) STRICT;
CREATE TABLE infrastructure_settings (
 setting_key TEXT PRIMARY KEY, value_payload TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0)
) STRICT;
INSERT INTO infrastructure_settings VALUES ('maxStoredPhotoBytes','{"version":1,"value":["number",1572864]}',1);
CREATE TABLE jobs (
 job_id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES users(user_id),
 state TEXT NOT NULL CHECK(state IN('draft','published','reserved','assigned','working','client_accepted','completed','expired','cancelled')),
 selected_master_id TEXT REFERENCES users(user_id), selected_chat_id TEXT REFERENCES chat_threads(chat_id) DEFERRABLE INITIALLY DEFERRED,
 resolution_id TEXT REFERENCES resolution_cases(case_id) DEFERRABLE INITIALLY DEFERRED, linked_job_id TEXT REFERENCES jobs(job_id),
 accepted_at INTEGER, acceptance_operation_id TEXT, completed_at INTEGER, last_activity_at INTEGER, job_payload TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX one_linked_job ON jobs(linked_job_id) WHERE linked_job_id IS NOT NULL;
CREATE TABLE offers (
 offer_id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(job_id), master_id TEXT NOT NULL REFERENCES users(user_id),
 chat_id TEXT NOT NULL UNIQUE REFERENCES chat_threads(chat_id), catalog_key TEXT NOT NULL REFERENCES catalog_revisions(catalog_key),
 initial_price TEXT NOT NULL CHECK(initial_price='0' OR (initial_price NOT GLOB '*[^0-9]*' AND initial_price GLOB '[1-9]*')),
 initial_at INTEGER NOT NULL, state TEXT NOT NULL CHECK(state IN('open','selected','closed')),
 revised_payload TEXT NOT NULL, final_payload TEXT NOT NULL, closed_reason TEXT, UNIQUE(job_id,master_id)
) STRICT;
CREATE TABLE refusal_records (
 refusal_id TEXT PRIMARY KEY, master_id TEXT NOT NULL REFERENCES users(user_id), job_id TEXT NOT NULL REFERENCES jobs(job_id),
 offer_id TEXT REFERENCES offers(offer_id), resolution_decision_id TEXT, at INTEGER NOT NULL, operation_id TEXT NOT NULL UNIQUE
) STRICT;
CREATE TABLE refusal_streaks (master_id TEXT PRIMARY KEY REFERENCES users(user_id), streak INTEGER NOT NULL CHECK(streak>=0)) STRICT;
CREATE TABLE chat_threads (
 chat_id TEXT PRIMARY KEY, context_type TEXT NOT NULL CHECK(context_type IN('job','support')),
 mode TEXT NOT NULL CHECK(mode IN('temporary','working','support','closed')), created_at INTEGER NOT NULL,
 job_id TEXT REFERENCES jobs(job_id), client_id TEXT REFERENCES users(user_id), master_id TEXT REFERENCES users(user_id),
 user_id TEXT REFERENCES users(user_id), user_role TEXT CHECK(user_role IN('client','master')), basis TEXT CHECK(basis IN('repayment','resolution')), basis_id TEXT,
 client_spoke INTEGER NOT NULL CHECK(client_spoke IN(0,1)), master_spoke INTEGER NOT NULL CHECK(master_spoke IN(0,1)),
 protected INTEGER NOT NULL CHECK(protected IN(0,1)), waiting_for TEXT, reminder_payload TEXT NOT NULL, language_payload TEXT NOT NULL,
 CHECK((context_type='job' AND job_id IS NOT NULL AND client_id IS NOT NULL AND master_id IS NOT NULL AND client_id<>master_id
  AND user_id IS NULL AND user_role IS NULL AND basis IS NULL AND basis_id IS NULL AND mode<>'support') OR
 (context_type='support' AND job_id IS NULL AND client_id IS NULL AND master_id IS NULL AND user_id IS NOT NULL
  AND user_role IS NOT NULL AND basis IS NOT NULL AND basis_id IS NOT NULL AND mode IN('support','closed')))
) STRICT;
CREATE TABLE chat_messages (
 message_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chat_threads(chat_id), position INTEGER NOT NULL CHECK(position>=0),
 author_id TEXT NOT NULL, sender TEXT NOT NULL CHECK(sender IN('user','helpy')), original TEXT NOT NULL, original_language TEXT,
 photo_ids_payload TEXT NOT NULL, at INTEGER NOT NULL, UNIQUE(chat_id,position)
) STRICT;
CREATE TABLE inbox_messages (message_id TEXT PRIMARY KEY, recipient_id TEXT NOT NULL REFERENCES users(user_id), original TEXT NOT NULL, at INTEGER NOT NULL) STRICT;
CREATE TABLE feedback (feedback_id TEXT PRIMARY KEY, author_id TEXT NOT NULL, original TEXT NOT NULL, at INTEGER NOT NULL) STRICT;
CREATE TABLE job_financials (
 job_id TEXT PRIMARY KEY REFERENCES jobs(job_id), funds TEXT NOT NULL CHECK(funds IN('none','held','releasable','allocated')),
 financial_payload TEXT NOT NULL, reservation_payload TEXT NOT NULL
) STRICT;
CREATE TABLE payment_operations (
 operation_id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES job_financials(job_id), position INTEGER NOT NULL CHECK(position>=0),
 operation_payload TEXT NOT NULL, UNIQUE(job_id,position)
) STRICT;
CREATE TABLE master_finance (
 master_id TEXT PRIMARY KEY REFERENCES users(user_id), debt_amount TEXT, threshold_amount TEXT,
 CHECK(debt_amount IS NOT NULL OR threshold_amount IS NOT NULL),
 CHECK(debt_amount IS NULL OR debt_amount='0' OR (debt_amount NOT GLOB '*[^0-9]*' AND debt_amount GLOB '[1-9]*')),
 CHECK(threshold_amount IS NULL OR threshold_amount='0' OR (threshold_amount NOT GLOB '*[^0-9]*' AND threshold_amount GLOB '[1-9]*'))
) STRICT;
CREATE TABLE threshold_history (
 master_id TEXT NOT NULL REFERENCES users(user_id), version TEXT NOT NULL UNIQUE, position INTEGER NOT NULL UNIQUE CHECK(position>=0),
 amount TEXT, effective_at INTEGER NOT NULL, PRIMARY KEY(master_id,version),
 CHECK(amount IS NULL OR amount='0' OR (amount NOT GLOB '*[^0-9]*' AND amount GLOB '[1-9]*'))
) STRICT;
CREATE TABLE ledger_entries (
 ledger_id TEXT PRIMARY KEY, master_id TEXT NOT NULL REFERENCES users(user_id), basis TEXT NOT NULL UNIQUE,
 change_amount TEXT NOT NULL, at INTEGER NOT NULL, actor_id TEXT NOT NULL,
 CHECK(change_amount='0' OR (change_amount NOT GLOB '*[^0-9]*' AND change_amount GLOB '[1-9]*') OR
  (substr(change_amount,1,1)='-' AND substr(change_amount,2) NOT GLOB '*[^0-9]*' AND substr(change_amount,2) GLOB '[1-9]*'))
) STRICT;
CREATE TABLE financial_obligations (
 obligation_id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN('payout','refund','compensation')),
 job_id TEXT NOT NULL REFERENCES jobs(job_id), beneficiary_id TEXT NOT NULL REFERENCES users(user_id), decision_id TEXT,
 source_payment_id TEXT REFERENCES payment_operations(operation_id), amount TEXT NOT NULL,
 currency TEXT NOT NULL CHECK(currency='THB'), created_at INTEGER NOT NULL, settled INTEGER NOT NULL CHECK(settled IN(0,1)), type_payload TEXT NOT NULL,
 CHECK(amount='0' OR (amount NOT GLOB '*[^0-9]*' AND amount GLOB '[1-9]*'))
) STRICT;
CREATE UNIQUE INDEX one_payout_per_job ON financial_obligations(job_id) WHERE kind='payout';
CREATE TABLE transfer_attempts (
 attempt_id TEXT PRIMARY KEY, obligation_id TEXT NOT NULL REFERENCES financial_obligations(obligation_id),
 position INTEGER NOT NULL CHECK(position>=0), attempt_payload TEXT NOT NULL, UNIQUE(obligation_id,position)
) STRICT;
CREATE TABLE debt_repayments (
 request_id TEXT PRIMARY KEY, master_id TEXT NOT NULL REFERENCES users(user_id), amount TEXT NOT NULL,
 requested_at INTEGER NOT NULL, agreed_amount TEXT, status TEXT NOT NULL CHECK(status IN('requested','agreed','received','closed')),
 method TEXT CHECK(method IN('cash','bank_transfer')), support_chat_id TEXT REFERENCES chat_threads(chat_id), agreement_id TEXT,
 receipt_id TEXT UNIQUE, received_amount TEXT, received_method TEXT CHECK(received_method IN('cash','bank_transfer')),
 received_at INTEGER, actor_id TEXT, evidence TEXT,
 CHECK(amount='0' OR (amount NOT GLOB '*[^0-9]*' AND amount GLOB '[1-9]*')),
 CHECK(agreed_amount IS NULL OR agreed_amount='0' OR (agreed_amount NOT GLOB '*[^0-9]*' AND agreed_amount GLOB '[1-9]*')),
 CHECK(received_amount IS NULL OR received_amount='0' OR (received_amount NOT GLOB '*[^0-9]*' AND received_amount GLOB '[1-9]*')),
 CHECK((receipt_id IS NULL AND received_amount IS NULL AND received_method IS NULL AND received_at IS NULL AND actor_id IS NULL AND evidence IS NULL) OR
  (receipt_id IS NOT NULL AND received_amount IS NOT NULL AND received_method IS NOT NULL AND received_at IS NOT NULL AND actor_id IS NOT NULL AND evidence IS NOT NULL AND status='received'))
) STRICT;
CREATE TABLE resolution_cases (
 case_id TEXT PRIMARY KEY, job_id TEXT NOT NULL UNIQUE REFERENCES jobs(job_id), request_id TEXT, opened_at INTEGER NOT NULL,
 snapshot_policy TEXT NOT NULL REFERENCES policies(version), evidence_payload TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('admin_resolution_pending','decided','closed_by_master_completion')),
 decision_id TEXT UNIQUE, decision_payload TEXT, CHECK((decision_id IS NULL)=(decision_payload IS NULL))
) STRICT;
CREATE TABLE reviews (
 review_id TEXT PRIMARY KEY, job_id TEXT NOT NULL UNIQUE REFERENCES jobs(job_id), client_id TEXT NOT NULL REFERENCES users(user_id),
 master_id TEXT NOT NULL REFERENCES users(user_id), stars INTEGER NOT NULL CHECK(stars BETWEEN 1 AND 5), marks_payload TEXT NOT NULL,
 comment TEXT NOT NULL, created_at INTEGER NOT NULL, hidden INTEGER NOT NULL CHECK(hidden IN(0,1)), moderation_payload TEXT
) STRICT;
CREATE TABLE hidden_history (
 user_id TEXT NOT NULL REFERENCES users(user_id), role TEXT NOT NULL CHECK(role IN('client','master')), job_id TEXT NOT NULL REFERENCES jobs(job_id),
 PRIMARY KEY(user_id,role,job_id)
) STRICT;
CREATE TABLE domain_events (
 event_id TEXT PRIMARY KEY, event_sequence INTEGER NOT NULL UNIQUE CHECK(event_sequence>=0), operation_id TEXT NOT NULL,
 type TEXT NOT NULL, subject_id TEXT NOT NULL, actor_id TEXT NOT NULL, actor_role TEXT CHECK(actor_role IN('client','master','admin')), at INTEGER NOT NULL,
 recipients_payload TEXT NOT NULL, roles_payload TEXT NOT NULL, facts_payload TEXT NOT NULL, context_payload TEXT NOT NULL,
 proof_payload TEXT NOT NULL, timers_payload TEXT NOT NULL, retentions_payload TEXT NOT NULL, policy_version TEXT REFERENCES policies(version)
) STRICT;
CREATE TABLE notification_preferences (
 user_id TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN('client','master','admin')), events_payload TEXT NOT NULL,
 channels_payload TEXT NOT NULL, sound_requested INTEGER NOT NULL CHECK(sound_requested IN(0,1)),
 PRIMARY KEY(user_id,role)
) STRICT;
CREATE TABLE deliveries (
 delivery_id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES domain_events(event_id), recipient_id TEXT NOT NULL,
 recipient_role TEXT NOT NULL CHECK(recipient_role IN('client','master','admin')), channel TEXT NOT NULL,
 attempt INTEGER NOT NULL CHECK(attempt>0), status TEXT NOT NULL CHECK(status IN('requested','pending','delivered','failed')),
 UNIQUE(event_id,recipient_id,channel)
) STRICT;
CREATE TABLE retention_records (
 fact_id TEXT NOT NULL, record_kind TEXT NOT NULL CHECK(record_kind IN('current','origin')),
 kind TEXT NOT NULL CHECK(kind IN('communication','evidence','financial','audit','account')), anchor INTEGER,
 anchor_kind TEXT NOT NULL CHECK(anchor_kind IN('completed','recorded')), deadline INTEGER,
 policy_version TEXT NOT NULL REFERENCES policies(version), PRIMARY KEY(fact_id,record_kind)
) STRICT;
CREATE TABLE photo_metadata (
 photo_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, format TEXT NOT NULL,
 business_ref_kind TEXT NOT NULL CHECK(business_ref_kind IN('profile','job','chat')), business_ref_id TEXT NOT NULL,
 present INTEGER NOT NULL CHECK(present IN(0,1))
) STRICT;
CREATE TRIGGER consumed_claims_no_update BEFORE UPDATE ON consumed_claims BEGIN SELECT RAISE(ABORT,'immutable claim'); END;
CREATE TRIGGER consumed_claims_no_delete BEFORE DELETE ON consumed_claims BEGIN SELECT RAISE(ABORT,'immutable claim'); END;
CREATE TRIGGER policies_no_update BEFORE UPDATE ON policies BEGIN SELECT RAISE(ABORT,'immutable policy'); END;
CREATE TRIGGER policies_no_delete BEFORE DELETE ON policies BEGIN SELECT RAISE(ABORT,'immutable policy'); END;
CREATE TRIGGER events_no_update BEFORE UPDATE ON domain_events BEGIN SELECT RAISE(ABORT,'immutable event'); END;
CREATE TRIGGER events_no_delete BEFORE DELETE ON domain_events BEGIN SELECT RAISE(ABORT,'immutable event'); END;
CREATE TRIGGER ledger_no_update BEFORE UPDATE ON ledger_entries BEGIN SELECT RAISE(ABORT,'immutable ledger'); END;
CREATE TRIGGER ledger_no_delete BEFORE DELETE ON ledger_entries BEGIN SELECT RAISE(ABORT,'immutable ledger'); END;
CREATE TRIGGER refusals_no_update BEFORE UPDATE ON refusal_records BEGIN SELECT RAISE(ABORT,'immutable refusal'); END;
CREATE TRIGGER refusals_no_delete BEFORE DELETE ON refusal_records BEGIN SELECT RAISE(ABORT,'immutable refusal'); END;
CREATE TRIGGER inbox_no_update BEFORE UPDATE ON inbox_messages BEGIN SELECT RAISE(ABORT,'immutable inbox'); END;
CREATE TRIGGER inbox_no_delete BEFORE DELETE ON inbox_messages BEGIN SELECT RAISE(ABORT,'immutable inbox'); END;
