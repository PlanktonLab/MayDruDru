/* 自動產生，請勿手改。來源：apps/api 的 OpenAPI（npm run generate -w @maydru/api-client）。 */
export interface paths {
    "/api/admin/applications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List Queue
         * @description 佇列固定依 `first_submitted_at` 排序——補件不重排是對民眾的承諾（SPEC §7）。
         */
        get: operations["list_queue_api_admin_applications_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/applications/{case_no}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Application */
        get: operations["get_application_api_admin_applications__case_no__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/applications/{case_no}/assign": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Assign
         * @description 指派（或取消指派）承辦人。只能指派同一個機關裡的人。
         */
        post: operations["assign_api_admin_applications__case_no__assign_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/applications/{case_no}/documents/{doc_id}/ocr": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Put Reviewer Ocr
         * @description 承辦人在自己的瀏覽器重新辨識（`source=reviewer`），存完立刻重跑規則。
         *
         *     重跑的結果會蓋過申請人版本的判定——`source=applicant` 的 OCR 依 SPEC §11 一律
         *     視為不可信。
         */
        post: operations["put_reviewer_ocr_api_admin_applications__case_no__documents__doc_id__ocr_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/applications/{case_no}/documents/{doc_id}/url": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Document Url
         * @description 5 分鐘的 presigned URL。檔案本身永遠不經過這支 API（SPEC §11）。
         */
        get: operations["document_url_api_admin_applications__case_no__documents__doc_id__url_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/applications/{case_no}/evaluate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Evaluate Case
         * @description 重跑規則引擎：目前版本的每份文件、每份文件最新的 OCR。
         */
        post: operations["evaluate_case_api_admin_applications__case_no__evaluate_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/applications/{case_no}/findings/{rule_code}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Override Finding
         * @description 人工覆寫一條規則的判定：**另寫一列** `source=reviewer`，舊的留著（SPEC §8.3）。
         */
        put: operations["override_finding_api_admin_applications__case_no__findings__rule_code__put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/applications/{case_no}/transitions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Post Transition
         * @description 唯一的狀態變更入口。每一條規則的檢查都在 service 裡（CLAUDE.md 規則 5）。
         *
         *     被核准前置條件擋下來時回 `409 {code, blockers}`——承辦人要知道「還差哪幾條規則」，
         *     而不是只看到一句「不行」。
         */
        post: operations["post_transition_api_admin_applications__case_no__transitions_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/audit-logs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Audit Logs */
        get: operations["list_audit_logs_api_admin_audit_logs_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/contents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Contents */
        get: operations["list_contents_api_admin_contents_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/contents/categories": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Categories */
        get: operations["categories_api_admin_contents_categories_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/contents/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Preview */
        post: operations["preview_api_admin_contents_preview_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/contents/{key}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get Content
         * @description 讀取時補列（youth-line-bot 也是）：沒有 `version` 就鎖不住第一次編輯。
         */
        get: operations["get_content_api_admin_contents__key__get"];
        /** Save Draft */
        put: operations["save_draft_api_admin_contents__key__put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/contents/{key}/publish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Publish */
        post: operations["publish_api_admin_contents__key__publish_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/contents/{key}/reset": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Reset */
        post: operations["reset_api_admin_contents__key__reset_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/copilot/contents/{key}/draft": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Draft Content
         * @description 助理 (a)：依這個 key 的說明、語氣與變數產生草稿，只寫 `contents.draft`。
         */
        post: operations["draft_content_api_admin_copilot_contents__key__draft_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/copilot/faq-suggestions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Faq Suggestions */
        get: operations["list_faq_suggestions_api_admin_copilot_faq_suggestions_get"];
        put?: never;
        /**
         * Generate Faq Suggestions
         * @description 助理 (b)：把未命中訊息聚類，每一群請模型寫一則 FAQ 建議。
         */
        post: operations["generate_faq_suggestions_api_admin_copilot_faq_suggestions_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/copilot/faq-suggestions/{suggestion_id}/accept": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Accept Faq Suggestion
         * @description 採用建議：建出一則**停用中**的 FAQ（`source=copilot`），等承辦人員改完再啟用。
         */
        post: operations["accept_faq_suggestion_api_admin_copilot_faq_suggestions__suggestion_id__accept_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/copilot/faq-suggestions/{suggestion_id}/dismiss": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Dismiss Faq Suggestion */
        post: operations["dismiss_faq_suggestion_api_admin_copilot_faq_suggestions__suggestion_id__dismiss_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/copilot/schemes/{code}/drafts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Scheme Drafts
         * @description 助理 (c)：依方案設定一次產出整套對外文案的草稿（狀態、退件說明、文件指引）。
         */
        post: operations["scheme_drafts_api_admin_copilot_schemes__code__drafts_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/faqs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Faqs */
        get: operations["list_faqs_api_admin_faqs_get"];
        put?: never;
        /** Create Faq */
        post: operations["create_faq_api_admin_faqs_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/faqs/{faq_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Update Faq */
        put: operations["update_faq_api_admin_faqs__faq_id__put"];
        post?: never;
        /** Delete Faq */
        delete: operations["delete_faq_api_admin_faqs__faq_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/faqs/{faq_id}/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Set Faq Status */
        post: operations["set_faq_status_api_admin_faqs__faq_id__status_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/help-chat": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read Settings */
        get: operations["read_settings_api_admin_help_chat_get"];
        /** Write Settings */
        put: operations["write_settings_api_admin_help_chat_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/knowledge": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Documents */
        get: operations["list_documents_api_admin_knowledge_get"];
        put?: never;
        /** Create Document */
        post: operations["create_document_api_admin_knowledge_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/knowledge/{document_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Document */
        get: operations["get_document_api_admin_knowledge__document_id__get"];
        /** Update Document */
        put: operations["update_document_api_admin_knowledge__document_id__put"];
        post?: never;
        /** Delete Document */
        delete: operations["delete_document_api_admin_knowledge__document_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/line/feedback": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Feedback */
        get: operations["feedback_api_admin_line_feedback_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/line/notifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Notifications */
        get: operations["notifications_api_admin_line_notifications_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/line/notifications/demo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Send Demo Notification
         * @description 不改案件狀態，向已綁定該案件的 LINE 使用者送出 Demo 缺件提醒。
         */
        post: operations["send_demo_notification_api_admin_line_notifications_demo_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/line/richmenu": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Richmenu Status */
        get: operations["richmenu_status_api_admin_line_richmenu_get"];
        put?: never;
        post?: never;
        /** Richmenu Remove */
        delete: operations["richmenu_remove_api_admin_line_richmenu_delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/line/richmenu/image": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Richmenu Image
         * @description 目前選單圖；沒有客製圖時回傳系統內建美術稿。
         */
        get: operations["richmenu_image_api_admin_line_richmenu_image_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/line/richmenu/sync": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Richmenu Sync
         * @description 建立並發布圖文選單。沒有上傳圖就沿用目前那一張（或內建美術稿）。
         */
        post: operations["richmenu_sync_api_admin_line_richmenu_sync_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/line/sync-logs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Sync Logs */
        get: operations["sync_logs_api_admin_line_sync_logs_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/line/unmatched": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Unmatched
         * @description 意圖沒命中的自由文字，餵給內容助理 (b)（SPEC §8.6）。只有 userId 的 hash。
         */
        get: operations["unmatched_api_admin_line_unmatched_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/line/unmatched/{message_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Dismiss Unmatched
         * @description 處理過的訊息就刪掉——這張表是待辦清單，不是紀錄。
         */
        delete: operations["dismiss_unmatched_api_admin_line_unmatched__message_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/media": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Media */
        get: operations["list_media_api_admin_media_get"];
        put?: never;
        /** Upload */
        post: operations["upload_api_admin_media_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/media/{media_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete */
        delete: operations["delete_api_admin_media__media_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/reviewers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List Reviewers
         * @description 指派選單的選項。停用的帳號不出現——停用就是「不要再派給他」。
         */
        get: operations["list_reviewers_api_admin_reviewers_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/schemes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Schemes */
        get: operations["list_schemes_api_admin_schemes_get"];
        put?: never;
        /** Create Scheme */
        post: operations["create_scheme_api_admin_schemes_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/schemes/{code}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get Scheme
         * @description 後台要看的是完整設定（含 review_rules 與 staff_label），不是公開檢視。
         */
        get: operations["get_scheme_api_admin_schemes__code__get"];
        put?: never;
        post?: never;
        /** Delete Scheme */
        delete: operations["delete_scheme_api_admin_schemes__code__delete"];
        options?: never;
        head?: never;
        /** Patch Scheme */
        patch: operations["patch_scheme_api_admin_schemes__code__patch"];
        trace?: never;
    };
    "/api/admin/schemes/{code}/document-types/{dt_code}/sop-flows": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Sop Flows */
        get: operations["list_sop_flows_api_admin_schemes__code__document_types__dt_code__sop_flows_get"];
        /** Put Sop Flows */
        put: operations["put_sop_flows_api_admin_schemes__code__document_types__dt_code__sop_flows_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/schemes/{code}/eligible-tools/pending": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List Pending Tools
         * @description 待審工具佇列：民眾打了、但清單上還沒有的工具名稱。
         */
        get: operations["list_pending_tools_api_admin_schemes__code__eligible_tools_pending_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/schemes/{code}/eligible-tools/{tool_id}/resolve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Resolve Eligible Tool
         * @description 核可／退回一筆待審工具，或把它併進既有的那一筆。
         */
        post: operations["resolve_eligible_tool_api_admin_schemes__code__eligible_tools__tool_id__resolve_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/schemes/{code}/review-rules/evaluate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Evaluate Review Rules
         * @description 規則編輯器的「試算」：貼一段 OCR 文字，看規則會判成什麼。不落地。
         *
         *     後台的試算面板在瀏覽器裡跑 `@maydru/review-rules` 給即時回饋，這一支跑的是
         *     伺服器上的 Python 版。兩邊對同一段文字必須判得一樣——承辦人員按這顆按鈕，
         *     就是在確認他剛寫的規則在真正做判定的那一側也成立（SPEC §14「規則一致性」）。
         */
        post: operations["evaluate_review_rules_api_admin_schemes__code__review_rules_evaluate_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/schemes/{code}/settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get Scheme Settings
         * @description 案件頁要的方案設定：退件碼（含 `staff_label`）、文件類型、管道、級距、天數。
         *
         *     要 `case_review` 而不是 `admin`——承辦人不能改方案，但看不到退件碼的內部說法就
         *     沒辦法退件。必須排在 `/{code}/{kind}` 之前，否則 `settings` 會被當成子設定表。
         */
        get: operations["get_scheme_settings_api_admin_schemes__code__settings_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/schemes/{code}/{kind}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Children */
        get: operations["list_children_api_admin_schemes__code___kind__get"];
        put?: never;
        /** Create Child */
        post: operations["create_child_api_admin_schemes__code___kind__post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/schemes/{code}/{kind}/reorder": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Reorder Children
         * @description 把整個分頁的 `sort_order` 按送上來的順序重寫一次。
         */
        post: operations["reorder_children_api_admin_schemes__code___kind__reorder_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/schemes/{code}/{kind}/{child_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete Child */
        delete: operations["delete_child_api_admin_schemes__code___kind___child_id__delete"];
        options?: never;
        head?: never;
        /** Patch Child */
        patch: operations["patch_child_api_admin_schemes__code___kind___child_id__patch"];
        trace?: never;
    };
    "/api/api-keys": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Keys */
        get: operations["list_keys_api_api_keys_get"];
        put?: never;
        /** Create Key */
        post: operations["create_key_api_api_keys_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/api-keys/{key_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete Key */
        delete: operations["delete_key_api_api_keys__key_id__delete"];
        options?: never;
        head?: never;
        /** Patch Key */
        patch: operations["patch_key_api_api_keys__key_id__patch"];
        trace?: never;
    };
    "/api/apply/applications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create Application
         * @description 匿名送件。檔案進 private bucket，OCR 存 `source=applicant`，判定由伺服器重跑。
         */
        post: operations["create_application_api_apply_applications_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/apply/applications/{case_no}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get Case
         * @description 市民看得到的案件：時間軸、補件項目、目前版本的文件清單。沒有承辦人資訊。
         *
         *     `public_label_key` 與 `next_action` 給的是 `contents` 的 key；`public_label` 與
         *     `next_action_text` 是同一組 key 由 `services/contents.t()` 渲染出來的字。router
         *     自己不組任何中文文案（CLAUDE.md 規則 4）——那些字是承辦人在後台發布的，
         *     伺服器只是把它讀出來，前端因此少一次 `GET /api/contents` 的往返。
         */
        get: operations["get_case_api_apply_applications__case_no__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/apply/applications/{case_no}/documents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Add Supplement
         * @description 補件（T4）。只收 `supplement_items` 列出的文件類型，其他一律退回。
         *
         *     送出後系統立刻走 T5 把案件放回審查佇列——`REVISION_SUBMITTED` 是過場狀態，
         *     和建案後立刻走 T1 是同一個道理。
         */
        post: operations["add_supplement_api_apply_applications__case_no__documents_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/apply/applications/{case_no}/withdraw": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Withdraw
         * @description 自行撤回（T10）。終態或不允許的狀態由狀態機擋下來，回 409。
         */
        post: operations["withdraw_api_apply_applications__case_no__withdraw_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/apply/faqs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List Faqs
         * @description 關鍵字搜尋（問題、答案與 keywords）。語意搜尋在 P4 接上 embedding。
         */
        get: operations["list_faqs_api_apply_faqs_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/apply/help-chat": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Ask */
        post: operations["ask_api_apply_help_chat_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/apply/schemes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List Schemes
         * @description 開放中的方案。停用的方案完全不出現在列表裡。
         */
        get: operations["list_schemes_api_apply_schemes_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/apply/schemes/{code}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get Scheme
         * @description 送件流程需要的完整方案設定，含 `review_rules`（前端即時回饋用）。
         */
        get: operations["get_scheme_api_apply_schemes__code__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/apply/schemes/{code}/required-documents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Required Documents
         * @description 必要文件由伺服器算（`scheme.required_document_types`），前端不自己推。
         */
        post: operations["required_documents_api_apply_schemes__code__required_documents_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/apply/schemes/{code}/tool-inquiries": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Inquire Tool */
        post: operations["inquire_tool_api_apply_schemes__code__tool_inquiries_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/apply/verify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Verify
         * @description 案號 + 末四碼 → 30 分鐘、只對這一件案子有效的 token（決策 D17）。
         *
         *     查無此案與末四碼錯誤的回應完全一致，否則錯誤訊息本身就成了查詢介面。
         */
        post: operations["verify_api_apply_verify_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/bootstrap": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Bootstrap
         * @description 建立第一個 owner。閘門是「沒有任何還在用的 owner」，不是「沒有 tenant」。
         *
         *     `scripts/seed.py` 會先建好機關，所以灌過種子、但一個使用者都沒有的機器，用
         *     tenant 數量判斷會永遠進不去（決策 D26）。tenant 已經在了就把 owner 掛上去，
         *     不再開第二個機關——一台機器一個機關是這套系統的部署形態。
         */
        post: operations["bootstrap_api_auth_bootstrap_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/bootstrap-status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Bootstrap Status
         * @description 還沒有任何人能登入時，前端才顯示「建立第一個管理者」（決策 D26）。
         */
        get: operations["bootstrap_status_api_auth_bootstrap_status_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Login */
        post: operations["login_api_auth_login_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Me */
        get: operations["me_api_auth_me_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/canvas": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Canvas */
        get: operations["get_canvas_api_canvas_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/canvas/layout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Save Layout */
        put: operations["save_layout_api_canvas_layout_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/components/{component_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete Component */
        delete: operations["delete_component_api_components__component_id__delete"];
        options?: never;
        head?: never;
        /** Patch Component */
        patch: operations["patch_component_api_components__component_id__patch"];
        trace?: never;
    };
    "/api/components/{component_id}/thumb.png": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Component Thumb */
        get: operations["component_thumb_api_components__component_id__thumb_png_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/contents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Contents */
        get: operations["get_contents_api_contents_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/contents/render": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Render
         * @description key + 變數 → 文字或 Flex（SPEC §10.1 的 `/v1/contents/render` 同一個 service）。
         */
        post: operations["render_api_contents_render_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/dashboard/summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Summary */
        get: operations["summary_api_dashboard_summary_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/edges": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create Edge */
        post: operations["create_edge_api_edges_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/edges/{edge_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete Edge */
        delete: operations["delete_edge_api_edges__edge_id__delete"];
        options?: never;
        head?: never;
        /** Patch Edge */
        patch: operations["patch_edge_api_edges__edge_id__patch"];
        trace?: never;
    };
    "/api/evals/cases": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Cases */
        get: operations["list_cases_api_evals_cases_get"];
        put?: never;
        /** Create Case */
        post: operations["create_case_api_evals_cases_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/evals/cases/{case_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete Case */
        delete: operations["delete_case_api_evals_cases__case_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/evals/cases/{case_id}/image.png": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Case Image */
        get: operations["case_image_api_evals_cases__case_id__image_png_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/evals/runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Runs */
        get: operations["list_runs_api_evals_runs_get"];
        put?: never;
        /** Start Run */
        post: operations["start_run_api_evals_runs_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/evals/runs/{run_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Run */
        get: operations["get_run_api_evals_runs__run_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/flows": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create Flow */
        post: operations["create_flow_api_flows_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/flows/{flow_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete Flow */
        delete: operations["delete_flow_api_flows__flow_id__delete"];
        options?: never;
        head?: never;
        /** Patch Flow */
        patch: operations["patch_flow_api_flows__flow_id__patch"];
        trace?: never;
    };
    "/api/flows/{flow_id}/publish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Publish */
        post: operations["publish_api_flows__flow_id__publish_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/flows/{flow_id}/render-cards": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Render Cards
         * @description Render every step's card again — after a template change, or new demo
         *     data. Each step keeps its own layout patch; only the picture is redone.
         */
        post: operations["render_cards_api_flows__flow_id__render_cards_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/flows/{flow_id}/rollback/{version_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Rollback */
        post: operations["rollback_api_flows__flow_id__rollback__version_id__post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/flows/{flow_id}/unpublish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Unpublish */
        post: operations["unpublish_api_flows__flow_id__unpublish_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/flows/{flow_id}/validate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Validate */
        get: operations["validate_api_flows__flow_id__validate_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/flows/{flow_id}/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Versions */
        get: operations["versions_api_flows__flow_id__versions_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/goals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Goals */
        get: operations["list_goals_api_goals_get"];
        put?: never;
        /** Create Goal */
        post: operations["create_goal_api_goals_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/goals/{goal_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Update Goal */
        put: operations["update_goal_api_goals__goal_id__put"];
        post?: never;
        /** Delete Goal */
        delete: operations["delete_goal_api_goals__goal_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/members": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Members */
        get: operations["list_members_api_members_get"];
        put?: never;
        /** Create Member */
        post: operations["create_member_api_members_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/members/{member_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete Member */
        delete: operations["delete_member_api_members__member_id__delete"];
        options?: never;
        head?: never;
        /** Patch Member */
        patch: operations["patch_member_api_members__member_id__patch"];
        trace?: never;
    };
    "/api/meta/annotation-types": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Annotation Types */
        get: operations["annotation_types_api_meta_annotation_types_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/platforms": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Platforms */
        get: operations["list_platforms_api_platforms_get"];
        put?: never;
        /** Create Platform */
        post: operations["create_platform_api_platforms_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/platforms/{platform_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete Platform */
        delete: operations["delete_platform_api_platforms__platform_id__delete"];
        options?: never;
        head?: never;
        /** Patch Platform */
        patch: operations["patch_platform_api_platforms__platform_id__patch"];
        trace?: never;
    };
    "/api/platforms/{platform_id}/components": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Components */
        get: operations["list_components_api_platforms__platform_id__components_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/platforms/{platform_id}/style-doc": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Style Doc */
        get: operations["get_style_doc_api_platforms__platform_id__style_doc_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Patch Style Doc */
        patch: operations["patch_style_doc_api_platforms__platform_id__style_doc_patch"];
        trace?: never;
    };
    "/api/platforms/{platform_id}/style-doc/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Style Doc Versions */
        get: operations["style_doc_versions_api_platforms__platform_id__style_doc_versions_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/playground/chats": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Chat Start */
        post: operations["chat_start_api_playground_chats_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/playground/chats/{chat_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Chat Status */
        get: operations["chat_status_api_playground_chats__chat_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/playground/chats/{chat_id}/messages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Chat Message */
        post: operations["chat_message_api_playground_chats__chat_id__messages_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/playground/sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Start */
        post: operations["start_api_playground_sessions_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/playground/sessions/{session_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Status */
        get: operations["status_api_playground_sessions__session_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/playground/sessions/{session_id}/actions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Action */
        post: operations["action_api_playground_sessions__session_id__actions_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/playground/sessions/{session_id}/messages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Text */
        post: operations["text_api_playground_sessions__session_id__messages_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/playground/sessions/{session_id}/screenshots": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Screenshot */
        post: operations["screenshot_api_playground_sessions__session_id__screenshots_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/review/queue": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Review Queue */
        get: operations["review_queue_api_review_queue_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sop/catalog/document-types": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Catalog Document Types
         * @description 有已發布教學的文件類型，供市民先選「要取得哪一份」。
         */
        get: operations["catalog_document_types_api_sop_catalog_document_types_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sop/catalog/flows": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Catalog Flows
         * @description 已發布的流程，可依平台過濾。
         */
        get: operations["catalog_flows_api_sop_catalog_flows_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sop/catalog/goals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Catalog Goals
         * @description 有教學的目標文件。
         */
        get: operations["catalog_goals_api_sop_catalog_goals_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sop/catalog/platforms": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Catalog Platforms
         * @description 有教學的平台（App／網頁／電腦版）。
         */
        get: operations["catalog_platforms_api_sop_catalog_platforms_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sop/document-types/{code}/flows": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Document Type Flows
         * @description 這份文件有哪些教學（SPEC §8.5 的 `document_type_sop_flows`）。
         *
         *     帶 `scheme` + `rejection_code` 時先看承辦人在那個退件碼上挑過哪幾條，
         *     沒挑才退回文件類型本身的對照。
         */
        get: operations["document_type_flows_api_sop_document_types__code__flows_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sop/flows/{flow_id}/steps": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Flow Steps
         * @description 一條已發布流程的逐步卡片（每一步一張編號圖，沒有圖就退回文字）。
         */
        get: operations["flow_steps_api_sop_flows__flow_id__steps_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sop/locate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Locate
         * @description 「我卡住了」：這張截圖是哪一步。
         *
         *     回 `{outcome, step, guidance, cards}`。圖片只在記憶體裡走一遭，永不落地。
         */
        post: operations["locate_api_sop_locate_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/steps": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create Step */
        post: operations["create_step_api_steps_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/steps/{step_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Step */
        get: operations["get_step_api_steps__step_id__get"];
        put?: never;
        post?: never;
        /** Delete Step */
        delete: operations["delete_step_api_steps__step_id__delete"];
        options?: never;
        head?: never;
        /** Patch Step */
        patch: operations["patch_step_api_steps__step_id__patch"];
        trace?: never;
    };
    "/api/steps/{step_id}/duplicate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Duplicate Step
         * @description Copy a step (text + desensitised replica, annotations and Step Card) into a
         *     flow — for shared steps like 登入 / 首頁 (SPEC §6.1).
         */
        post: operations["duplicate_step_api_steps__step_id__duplicate_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tenant": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Tenant */
        get: operations["get_tenant_api_tenant_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tenant/assistant": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Assistant Settings */
        get: operations["get_assistant_settings_api_tenant_assistant_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tenant/policy": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get Policy
         * @description The tenant's 客服策略, resolved (blanks filled with the language's
         *     built-ins), plus the built-in templates so the UI can show what a blank
         *     means and which keys can be overridden.
         */
        get: operations["get_policy_api_tenant_policy_get"];
        /**
         * Set Policy
         * @description Voice (language, name, tone, goal noun, extra rules, hand-off line),
         *     behaviour (delivery, what each screenshot outcome turns into, confidence
         *     bars) and template overrides. Fields equal to the built-in are stored as
         *     blanks so a later change of language picks up the new built-ins.
         */
        put: operations["set_policy_api_tenant_policy_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tenant/stepcard-layout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Set Tenant Layout
         * @description The Step Card layout every step of this channel renders with unless it
         *     has its own (SPEC §9.1). Already-rendered cards keep their picture.
         */
        put: operations["set_tenant_layout_api_tenant_stepcard_layout_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/variants/{variant_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Variant */
        get: operations["get_variant_api_variants__variant_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/variants/{variant_id}/annotations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Set Annotations */
        put: operations["set_annotations_api_variants__variant_id__annotations_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/variants/{variant_id}/card-preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Card Preview
         * @description The card as HTML for the layout editor: the worker's exact page, drawn
         *     with the given (or stored) template and step patch and the unsaved
         *     annotations. The editor then moves things live through CSS variables.
         */
        post: operations["card_preview_api_variants__variant_id__card_preview_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/variants/{variant_id}/components": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create Component */
        post: operations["create_component_api_variants__variant_id__components_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/variants/{variant_id}/fake-data": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Sync Fake Data
         * @description 假資料同步 (SPEC §6.5): the clerk's answer to what this replica reported
         *     inventing. Picked values join the platform's 示範資料, so every screen after
         *     this one uses them; `regenerate` draws this screen again first, since a
         *     value they corrected is still wrong on the image in front of them.
         */
        post: operations["sync_fake_data_api_variants__variant_id__fake_data_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/variants/{variant_id}/focus-boxes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Set Focus Boxes */
        put: operations["set_focus_boxes_api_variants__variant_id__focus_boxes_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/variants/{variant_id}/original": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Upload Original */
        post: operations["upload_original_api_variants__variant_id__original_post"];
        /** Delete Original */
        delete: operations["delete_original_api_variants__variant_id__original_delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/variants/{variant_id}/original.png": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get Original
         * @description Only the uploader and admins may view an original (SPEC §12).
         */
        get: operations["get_original_api_variants__variant_id__original_png_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/variants/{variant_id}/process": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Process */
        post: operations["process_api_variants__variant_id__process_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/variants/{variant_id}/render-card": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Render Card */
        post: operations["render_card_api_variants__variant_id__render_card_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/variants/{variant_id}/replica-html": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Advanced Edit
         * @description Admin-only advanced mode (SPEC §6.2 step 5): direct HTML edit, re-rendered
         *     outside the graph. The same programmatic checks as the pipeline apply.
         */
        put: operations["advanced_edit_api_variants__variant_id__replica_html_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/variants/{variant_id}/replica.html": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Replica Html */
        get: operations["replica_html_api_variants__variant_id__replica_html_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/variants/{variant_id}/replica.png": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Replica Png */
        get: operations["replica_png_api_variants__variant_id__replica_png_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/variants/{variant_id}/review": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Review */
        post: operations["review_api_variants__variant_id__review_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/variants/{variant_id}/stepcard-layout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Set Layout
         * @description Store this step's changes to the template — only the keys it touched —
         *     or clear them so it follows the template again. The card is rendered
         *     again by hand.
         */
        put: operations["set_layout_api_variants__variant_id__stepcard_layout_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Health */
        get: operations["health_health_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/line/webhook": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Webhook
         * @description 驗簽後立刻回 200，事件在背景處理。
         */
        post: operations["webhook_line_webhook_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/media/{key}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Media */
        get: operations["media_media__key__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/applications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create Application */
        post: operations["create_application_v1_applications_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/applications/{case_no}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Application */
        get: operations["get_application_v1_applications__case_no__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/applications/{case_no}/documents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Add Documents */
        post: operations["add_documents_v1_applications__case_no__documents_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/applications/{case_no}/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Application Events */
        get: operations["application_events_v1_applications__case_no__events_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/applications/{case_no}/findings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Findings */
        get: operations["findings_v1_applications__case_no__findings_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/applications/{case_no}/findings/{rule_code}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Update Finding */
        put: operations["update_finding_v1_applications__case_no__findings__rule_code__put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/applications/{case_no}/transitions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Transition Application */
        post: operations["transition_application_v1_applications__case_no__transitions_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/catalog/document-types": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Catalog Document Types */
        get: operations["catalog_document_types_v1_catalog_document_types_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/catalog/flows": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Catalog Flows */
        get: operations["catalog_flows_v1_catalog_flows_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/catalog/flows/{flow_id}/cards": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Catalog Cards */
        get: operations["catalog_cards_v1_catalog_flows__flow_id__cards_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/catalog/goals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Catalog Goals */
        get: operations["catalog_goals_v1_catalog_goals_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/catalog/platforms": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Catalog Platforms */
        get: operations["catalog_platforms_v1_catalog_platforms_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/chat": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create Chat
         * @description Opens a chat and returns the greeting. Messages come back as
         *     `{kind: text|image|choices, …}`; `choices` carries `text` (the question)
         *     and `options[].label` — send the chosen label back as a text message.
         */
        post: operations["create_chat_v1_chat_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/chat/{chat_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Chat Status */
        get: operations["chat_status_v1_chat__chat_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/chat/{chat_id}/messages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Chat Message
         * @description One turn: text, a screenshot, or both (multipart). Every picture gets
         *     an answer — a located step and the cards from there, a question with
         *     options, or a request for a better picture.
         */
        post: operations["chat_message_v1_chat__chat_id__messages_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/contents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Contents */
        get: operations["list_contents_v1_contents_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/contents/render": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Render Content */
        post: operations["render_content_v1_contents_render_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/contents/{key}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Content */
        get: operations["get_content_v1_contents__key__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/document-types/{code}/flows": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Document Type Flows
         * @description The published flows that teach how to obtain one document type
         *     (SPEC §8.5). With `scheme` + `rejection_code` the clerk's picks on that
         *     rejection code win; the document type's own mapping is the fallback.
         */
        get: operations["document_type_flows_v1_document_types__code__flows_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/faqs/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Search Faqs */
        post: operations["search_faqs_v1_faqs_search_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/flows/{flow_id}/steps": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Flow Steps
         * @description The steps of a published flow toward one goal, and the messages a
         *     channel sends for them (one numbered card per step). `from_step_id`
         *     starts partway (after a screenshot located the citizen).
         */
        get: operations["flow_steps_v1_flows__flow_id__steps_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/intent": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Parse Intent
         * @description The citizen's words → platform, goal and the published flow that
         *     delivers it; `needs` lists what is still missing (platform / channel /
         *     goal / flow) so the caller can ask.
         */
        post: operations["parse_intent_v1_intent_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/intent/classify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Classify Intent */
        post: operations["classify_intent_v1_intent_classify_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/locate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Locate Screenshot
         * @description Where is this screenshot? Returns the outcome (located / ambiguous /
         *     off_flow / unknown_platform / not_app_screen / not_a_screenshot /
         *     unreadable), the best step with confidence, the candidates, and a
         *     `guidance` block saying what to do next (steps to send, question to ask).
         *     `platform_id` is a hard filter; `flow_id`/`step_id`/`goal_id` describe
         *     where the citizen was, which the ranking favours.
         */
        post: operations["locate_screenshot_v1_locate_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/notifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Notifications */
        get: operations["notifications_v1_notifications_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/review/evaluate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Evaluate */
        post: operations["evaluate_v1_review_evaluate_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/review/rules": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Review Rules */
        get: operations["review_rules_v1_review_rules_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/schemes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Schemes */
        get: operations["list_schemes_v1_schemes_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/schemes/{code}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Scheme */
        get: operations["get_scheme_v1_schemes__code__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create Session */
        post: operations["create_session_v1_sessions_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sessions/{session_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Session */
        get: operations["get_session_v1_sessions__session_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sessions/{session_id}/actions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Send Action */
        post: operations["send_action_v1_sessions__session_id__actions_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sessions/{session_id}/messages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Send Message */
        post: operations["send_message_v1_sessions__session_id__messages_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sessions/{session_id}/screenshots": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Send Screenshot */
        post: operations["send_screenshot_v1_sessions__session_id__screenshots_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sop/catalog/document-types": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Sop Catalog Document Types */
        get: operations["sop_catalog_document_types_v1_sop_catalog_document_types_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sop/catalog/flows": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Sop Catalog Flows */
        get: operations["sop_catalog_flows_v1_sop_catalog_flows_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sop/catalog/flows/{flow_id}/cards": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Sop Catalog Cards */
        get: operations["sop_catalog_cards_v1_sop_catalog_flows__flow_id__cards_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sop/catalog/goals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Sop Catalog Goals */
        get: operations["sop_catalog_goals_v1_sop_catalog_goals_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sop/catalog/platforms": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Sop Catalog Platforms */
        get: operations["sop_catalog_platforms_v1_sop_catalog_platforms_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sop/chat": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Sop Create Chat
         * @description Opens a chat and returns the greeting. Messages come back as
         *     `{kind: text|image|choices, …}`; `choices` carries `text` (the question)
         *     and `options[].label` — send the chosen label back as a text message.
         */
        post: operations["sop_create_chat_v1_sop_chat_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sop/chat/{chat_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Sop Chat Status */
        get: operations["sop_chat_status_v1_sop_chat__chat_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sop/chat/{chat_id}/messages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Sop Chat Message
         * @description One turn: text, a screenshot, or both (multipart). Every picture gets
         *     an answer — a located step and the cards from there, a question with
         *     options, or a request for a better picture.
         */
        post: operations["sop_chat_message_v1_sop_chat__chat_id__messages_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sop/document-types/{code}/flows": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Sop Document Type Flows
         * @description The published flows that teach how to obtain one document type
         *     (SPEC §8.5). With `scheme` + `rejection_code` the clerk's picks on that
         *     rejection code win; the document type's own mapping is the fallback.
         */
        get: operations["sop_document_type_flows_v1_sop_document_types__code__flows_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sop/flows/{flow_id}/steps": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Sop Flow Steps
         * @description The steps of a published flow toward one goal, and the messages a
         *     channel sends for them (one numbered card per step). `from_step_id`
         *     starts partway (after a screenshot located the citizen).
         */
        get: operations["sop_flow_steps_v1_sop_flows__flow_id__steps_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sop/intent": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Sop Parse Intent
         * @description The citizen's words → platform, goal and the published flow that
         *     delivers it; `needs` lists what is still missing (platform / channel /
         *     goal / flow) so the caller can ask.
         */
        post: operations["sop_parse_intent_v1_sop_intent_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sop/locate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Sop Locate Screenshot
         * @description Where is this screenshot? Returns the outcome (located / ambiguous /
         *     off_flow / unknown_platform / not_app_screen / not_a_screenshot /
         *     unreadable), the best step with confidence, the candidates, and a
         *     `guidance` block saying what to do next (steps to send, question to ask).
         *     `platform_id` is a hard filter; `flow_id`/`step_id`/`goal_id` describe
         *     where the citizen was, which the ranking favours.
         */
        post: operations["sop_locate_screenshot_v1_sop_locate_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sop/sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Sop Create Session */
        post: operations["sop_create_session_v1_sop_sessions_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sop/sessions/{session_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Sop Get Session */
        get: operations["sop_get_session_v1_sop_sessions__session_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sop/sessions/{session_id}/actions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Sop Send Action */
        post: operations["sop_send_action_v1_sop_sessions__session_id__actions_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sop/sessions/{session_id}/messages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Sop Send Message */
        post: operations["sop_send_message_v1_sop_sessions__session_id__messages_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sop/sessions/{session_id}/screenshots": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Sop Send Screenshot */
        post: operations["sop_send_screenshot_v1_sop_sessions__session_id__screenshots_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/webhook-deliveries": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Deliveries */
        get: operations["list_deliveries_v1_webhook_deliveries_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/webhook-deliveries/{delivery_id}/resend": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Resend Delivery */
        post: operations["resend_delivery_v1_webhook_deliveries__delivery_id__resend_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/webhooks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Subscriptions */
        get: operations["list_subscriptions_v1_webhooks_get"];
        put?: never;
        /** Create Subscription */
        post: operations["create_subscription_v1_webhooks_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/webhooks/{subscription_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete Subscription */
        delete: operations["delete_subscription_v1_webhooks__subscription_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/webhooks/{subscription_id}/test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Test Subscription */
        post: operations["test_subscription_v1_webhooks__subscription_id__test_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** ActionIn */
        ActionIn: {
            /**
             * Action
             * @enum {string}
             */
            action: "next" | "prev" | "choose_branch" | "choose_option" | "restart";
            /** Edge Id */
            edge_id?: string | null;
            /** Option Id */
            option_id?: string | null;
        };
        /** ActiveIn */
        ActiveIn: {
            /** Active */
            active: boolean;
        };
        /** AdvancedEditIn */
        AdvancedEditIn: {
            /** Html */
            html: string;
        };
        /** AllowedTransitionOut */
        AllowedTransitionOut: {
            /** Code */
            code: string;
            /**
             * Label
             * @default
             */
            label: string;
            /**
             * Needs Reason
             * @default false
             */
            needs_reason: boolean;
            /**
             * Needs Rejection Codes
             * @default false
             */
            needs_rejection_codes: boolean;
            /**
             * Needs Supplement Items
             * @default false
             */
            needs_supplement_items: boolean;
            /**
             * To Status
             * @default
             */
            to_status: string;
        };
        /** Annotation */
        Annotation: {
            /**
             * Direction
             * @default
             * @enum {string}
             */
            direction: "up" | "down" | "left" | "right" | "long_press" | "";
            /**
             * Example Text
             * @default
             */
            example_text: string;
            /**
             * H
             * @default 0
             */
            h: number;
            /** Id */
            id: string;
            /** Label */
            label: string;
            /** Number */
            number: number;
            /**
             * Type
             * @enum {string}
             */
            type: "tap" | "capture" | "input" | "gesture" | "note";
            /**
             * W
             * @default 0
             */
            w: number;
            /** X */
            x: number;
            /** Y */
            y: number;
        };
        /** AnnotationsIn */
        AnnotationsIn: {
            /** Annotations */
            annotations: components["schemas"]["Annotation"][];
        };
        /** ApiKeyIn */
        ApiKeyIn: {
            /** Name */
            name: string;
            /**
             * Rate Limit Per Minute
             * @default 120
             */
            rate_limit_per_minute: number;
            /**
             * Scopes
             * @default [
             *       "read"
             *     ]
             */
            scopes: ("read" | "apply" | "review" | "sop" | "contents" | "webhooks" | "admin")[];
        };
        /** ApiKeyOut */
        ApiKeyOut: {
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Id */
            id: string;
            /** Last Used At */
            last_used_at: string | null;
            /** Name */
            name: string;
            /** Plaintext */
            plaintext?: string | null;
            /** Prefix */
            prefix: string;
            /** Rate Limit Per Minute */
            rate_limit_per_minute: number;
            /** Scopes */
            scopes: string[];
            /** Status */
            status: string;
        };
        /** ApiKeyPatch */
        ApiKeyPatch: {
            /** Name */
            name?: string | null;
            /** Rate Limit Per Minute */
            rate_limit_per_minute?: number | null;
            /** Scopes */
            scopes?: ("read" | "apply" | "review" | "sop" | "contents" | "webhooks" | "admin")[] | null;
            /** Status */
            status?: ("active" | "disabled") | null;
        };
        /**
         * ApplicationDetailOut
         * @description 案件頁（契約 §CaseDetail）。
         */
        ApplicationDetailOut: {
            /** Allowed Transitions */
            allowed_transitions: components["schemas"]["AllowedTransitionOut"][];
            /** Applicant Name */
            applicant_name: string;
            /** Applicant Name Masked */
            applicant_name_masked: string;
            /** Approval Blockers */
            approval_blockers: components["schemas"]["BlockerOut"][];
            /** Approved Amount */
            approved_amount: number | null;
            assigned_reviewer?: components["schemas"]["ReviewerOut"] | null;
            /** Assigned Reviewer Id */
            assigned_reviewer_id: string | null;
            /**
             * Billing Cycle
             * @default MONTHLY
             */
            billing_cycle: string;
            /**
             * Billing Periods
             * @default 1
             */
            billing_periods: number;
            /** Case No */
            case_no: string;
            /** Documents */
            documents: components["schemas"]["DocumentOut"][];
            /** Documents Purge At */
            documents_purge_at: string | null;
            /** Email */
            email: string;
            /** Events */
            events: components["schemas"]["EventOut"][];
            /** Findings */
            findings: components["schemas"]["app__routers__admin__schemas__FindingOut"][];
            /** First Submitted At */
            first_submitted_at: string | null;
            /**
             * Id Last4 Masked
             * @default
             */
            id_last4_masked: string;
            /** Intake Channel */
            intake_channel: string;
            /** Last Submitted At */
            last_submitted_at: string | null;
            /** Note */
            note: string;
            /** Original Amount */
            original_amount?: number | null;
            /**
             * Original Currency
             * @default TWD
             */
            original_currency: string;
            /** Paid By Proxy */
            paid_by_proxy: boolean;
            /** Payment Amount */
            payment_amount: number | null;
            /** Payment Channel Code */
            payment_channel_code: string;
            /** Payment Date */
            payment_date: string | null;
            /** Phone Masked */
            phone_masked: string;
            /** Purchase Amount */
            purchase_amount: number | null;
            /** Purchase Date */
            purchase_date: string | null;
            /** Required Document Types */
            required_document_types: string[];
            /** Revision Count */
            revision_count: number;
            /** Rules */
            rules: {
                [key: string]: unknown;
            }[];
            /**
             * Scheme Code
             * @default
             */
            scheme_code: string;
            /** Scheme Id */
            scheme_id: string;
            /**
             * Scheme Name
             * @default
             */
            scheme_name: string;
            scheme_settings: components["schemas"]["SchemeSettingsOut"];
            /** Status */
            status: string;
            /** Supplement Deadline */
            supplement_deadline: string | null;
            /** Supplement Items */
            supplement_items: {
                [key: string]: unknown;
            }[];
            /** Tier Code */
            tier_code: string;
            /** Tool Id */
            tool_id?: string | null;
            /** Tool Name */
            tool_name: string;
            /** Verdict */
            verdict?: string | null;
            /** Version */
            version: number;
        };
        /** ApplicationIn */
        ApplicationIn: {
            /** Applicant Name */
            applicant_name: string;
            /**
             * Documents
             * @default []
             */
            documents: {
                [key: string]: unknown;
            }[];
            /**
             * Email
             * @default
             */
            email: string;
            /**
             * Id Number
             * @default
             */
            id_number: string;
            /**
             * Note
             * @default
             */
            note: string;
            /**
             * Paid By Proxy
             * @default false
             */
            paid_by_proxy: boolean;
            /**
             * Payment Channel Code
             * @default
             */
            payment_channel_code: string;
            /**
             * Phone
             * @default
             */
            phone: string;
            /** Purchase Amount */
            purchase_amount?: number | null;
            /** Purchase Date */
            purchase_date?: string | null;
            /** Scheme */
            scheme: string;
            /**
             * Tier Code
             * @default
             */
            tier_code: string;
        };
        /**
         * ApplicationOut
         * @description 佇列列（契約 §QueueRow）。姓名遮蔽、電話只到末四碼——要看全名請開案件頁。
         */
        ApplicationOut: {
            /** Applicant Name Masked */
            applicant_name_masked: string;
            assigned_reviewer?: components["schemas"]["ReviewerOut"] | null;
            /** Assigned Reviewer Id */
            assigned_reviewer_id: string | null;
            /** Case No */
            case_no: string;
            /** First Submitted At */
            first_submitted_at: string | null;
            /** Intake Channel */
            intake_channel: string;
            /** Last Submitted At */
            last_submitted_at: string | null;
            /** Payment Channel Code */
            payment_channel_code: string;
            /** Purchase Amount */
            purchase_amount: number | null;
            /** Revision Count */
            revision_count: number;
            /**
             * Scheme Code
             * @default
             */
            scheme_code: string;
            /** Scheme Id */
            scheme_id: string;
            /**
             * Scheme Name
             * @default
             */
            scheme_name: string;
            /** Status */
            status: string;
            /** Supplement Deadline */
            supplement_deadline: string | null;
            /** Tier Code */
            tier_code: string;
            /** Tool Name */
            tool_name: string;
            /** Verdict */
            verdict?: string | null;
            /** Version */
            version: number;
        };
        /** AssignIn */
        AssignIn: {
            /** Reviewer Id */
            reviewer_id?: string | null;
        };
        /** AssignOut */
        AssignOut: {
            assigned_reviewer?: components["schemas"]["ReviewerOut"] | null;
        };
        /** BlockerOut */
        BlockerOut: {
            /**
             * Label
             * @default
             */
            label: string;
            /** Rule Code */
            rule_code: string;
            /**
             * Status
             * @default PENDING
             */
            status: string;
        };
        /** Body_add_supplement_api_apply_applications__case_no__documents_post */
        Body_add_supplement_api_apply_applications__case_no__documents_post: {
            /**
             * Documents
             * @description DocumentIn[] 的 JSON 字串，順序對應 file_0、file_1…
             * @default []
             */
            documents: string;
            /**
             * File 0
             * @description 第一份文件；其餘為 file_1、file_2…
             */
            file_0?: string | null;
        };
        /** Body_chat_message_api_playground_chats__chat_id__messages_post */
        Body_chat_message_api_playground_chats__chat_id__messages_post: {
            /** File */
            file?: string | null;
            /** Text */
            text?: string | null;
        };
        /** Body_chat_message_v1_chat__chat_id__messages_post */
        Body_chat_message_v1_chat__chat_id__messages_post: {
            /** File */
            file?: string | null;
            /** Text */
            text?: string | null;
        };
        /** Body_create_application_api_apply_applications_post */
        Body_create_application_api_apply_applications_post: {
            /**
             * Application
             * @description ApplicationIn 的 JSON 字串
             */
            application: string;
            /**
             * Documents
             * @description DocumentIn[] 的 JSON 字串，順序對應 file_0、file_1…
             * @default []
             */
            documents: string;
            /**
             * File 0
             * @description 第一份文件；其餘為 file_1、file_2…
             */
            file_0?: string | null;
        };
        /** Body_create_case_api_evals_cases_post */
        Body_create_case_api_evals_cases_post: {
            /** File */
            file: string;
            /** Goal Id */
            goal_id?: string | null;
            /**
             * Note
             * @default
             */
            note: string;
            /** Platform Id */
            platform_id: string;
            /** Step Id */
            step_id?: string | null;
            /**
             * Text
             * @default
             */
            text: string;
        };
        /** Body_locate_api_sop_locate_post */
        Body_locate_api_sop_locate_post: {
            /** File */
            file: string;
            /** Flow Id */
            flow_id?: string | null;
            /** Goal Id */
            goal_id?: string | null;
            /** Platform Id */
            platform_id?: string | null;
            /** Step Id */
            step_id?: string | null;
        };
        /** Body_locate_screenshot_v1_locate_post */
        Body_locate_screenshot_v1_locate_post: {
            /** File */
            file: string;
            /** Flow Id */
            flow_id?: string | null;
            /** Goal Id */
            goal_id?: string | null;
            /** Platform Id */
            platform_id?: string | null;
            /** Step Id */
            step_id?: string | null;
        };
        /** Body_richmenu_sync_api_admin_line_richmenu_sync_post */
        Body_richmenu_sync_api_admin_line_richmenu_sync_post: {
            /** Image */
            image?: string | null;
        };
        /** Body_screenshot_api_playground_sessions__session_id__screenshots_post */
        Body_screenshot_api_playground_sessions__session_id__screenshots_post: {
            /** File */
            file: string;
        };
        /** Body_send_screenshot_v1_sessions__session_id__screenshots_post */
        Body_send_screenshot_v1_sessions__session_id__screenshots_post: {
            /** File */
            file: string;
        };
        /** Body_sop_chat_message_v1_sop_chat__chat_id__messages_post */
        Body_sop_chat_message_v1_sop_chat__chat_id__messages_post: {
            /** File */
            file?: string | null;
            /** Text */
            text?: string | null;
        };
        /** Body_sop_locate_screenshot_v1_sop_locate_post */
        Body_sop_locate_screenshot_v1_sop_locate_post: {
            /** File */
            file: string;
            /** Flow Id */
            flow_id?: string | null;
            /** Goal Id */
            goal_id?: string | null;
            /** Platform Id */
            platform_id?: string | null;
            /** Step Id */
            step_id?: string | null;
        };
        /** Body_sop_send_screenshot_v1_sop_sessions__session_id__screenshots_post */
        Body_sop_send_screenshot_v1_sop_sessions__session_id__screenshots_post: {
            /** File */
            file: string;
        };
        /** Body_upload_api_admin_media_post */
        Body_upload_api_admin_media_post: {
            /**
             * Alt
             * @default
             */
            alt: string;
            /** File */
            file: string;
        };
        /** Body_upload_original_api_variants__variant_id__original_post */
        Body_upload_original_api_variants__variant_id__original_post: {
            /** File */
            file: string;
        };
        /** BootstrapIn */
        BootstrapIn: {
            /**
             * Owner Email
             * Format: email
             */
            owner_email: string;
            /**
             * Owner Name
             * @default Owner
             */
            owner_name: string;
            /** Owner Password */
            owner_password: string;
            /** Tenant Name */
            tenant_name: string;
            /** Tenant Slug */
            tenant_slug: string;
        };
        /** CanvasOut */
        CanvasOut: {
            /** Edges */
            edges: components["schemas"]["EdgeOut"][];
            /** Flows */
            flows: components["schemas"]["FlowOut"][];
            /** Goals */
            goals: components["schemas"]["GoalOut"][];
            /** Platforms */
            platforms: components["schemas"]["PlatformOut"][];
            /** Steps */
            steps: components["schemas"]["StepOut"][];
        };
        /** CardPreviewIn */
        CardPreviewIn: {
            /** Annotations */
            annotations?: components["schemas"]["Annotation"][] | null;
            patch?: components["schemas"]["StepCardLayoutPatch"] | null;
            template?: components["schemas"]["StepCardLayout"] | null;
        };
        /** CardPreviewOut */
        CardPreviewOut: {
            built_in: components["schemas"]["StepCardLayout"];
            /** Channel */
            channel: string;
            /** Html */
            html: string;
            layout: components["schemas"]["StepCardLayout"];
            /** Patch */
            patch: {
                [key: string]: unknown;
            };
            /** Replica H */
            replica_h: number;
            /** Replica W */
            replica_w: number;
            template: components["schemas"]["StepCardLayout"];
        };
        /** CaseDocumentOut */
        CaseDocumentOut: {
            /** Document Type Code */
            document_type_code: string;
            /** Is Current */
            is_current: boolean;
            /** Page Count */
            page_count: number;
            /**
             * Period Index
             * @default 1
             */
            period_index: number;
            /** Revision */
            revision: number;
            /** Uploaded At */
            uploaded_at?: string | null;
        };
        /** CaseEventOut */
        CaseEventOut: {
            /** Actor Type */
            actor_type: string;
            /** Created At */
            created_at?: string | null;
            /** From Status */
            from_status?: string | null;
            /** Rejection Codes */
            rejection_codes?: string[];
            /** To Status */
            to_status: string;
            /** Transition Code */
            transition_code: string;
        };
        /**
         * CasePublicOut
         * @description 市民看到的案件（契約 §CasePublic）。沒有姓名、電話、也沒有承辦人資訊。
         */
        CasePublicOut: {
            /**
             * Can Supplement
             * @default false
             */
            can_supplement: boolean;
            /**
             * Can Withdraw
             * @default false
             */
            can_withdraw: boolean;
            /** Case No */
            case_no: string;
            /** Documents */
            documents?: components["schemas"]["CaseDocumentOut"][];
            /** Events */
            events?: components["schemas"]["CaseEventOut"][];
            /** First Submitted At */
            first_submitted_at?: string | null;
            /** Last Submitted At */
            last_submitted_at?: string | null;
            /** Next Action */
            next_action?: string | null;
            /** Next Action Text */
            next_action_text?: string | null;
            /** Payment Date */
            payment_date?: string | null;
            /** Public Label */
            public_label?: string | null;
            /** Public Label Key */
            public_label_key?: string | null;
            /** Purchase Amount */
            purchase_amount?: number | null;
            /** Revision Count */
            revision_count: number;
            scheme: components["schemas"]["CaseSchemeOut"];
            /** Status */
            status: string;
            /** Supplement Deadline */
            supplement_deadline?: string | null;
            /** Supplement Items */
            supplement_items?: components["schemas"]["SupplementItemOut"][];
            /**
             * Tool Name
             * @default
             */
            tool_name: string;
        };
        /** CaseSchemeOut */
        CaseSchemeOut: {
            /** Code */
            code: string;
            /** Name */
            name: string;
        };
        /** ChatCreate */
        ChatCreate: {
            /** External User Id */
            external_user_id: string;
            /** Policy */
            policy?: {
                [key: string]: unknown;
            } | null;
            /**
             * Theme
             * @default light
             * @enum {string}
             */
            theme: "light" | "dark";
        };
        /** ChatReply */
        ChatReply: {
            /**
             * Role
             * @constant
             */
            role: "assistant";
            /** Source Ids */
            source_ids: string[];
            /** Text */
            text: string;
        };
        /** ChatSettings */
        ChatSettings: {
            /**
             * Enabled
             * @default true
             */
            enabled: boolean;
            /**
             * Max Question Chars
             * @default 500
             */
            max_question_chars: number;
            /**
             * Max Results
             * @default 2
             */
            max_results: number;
            /**
             * Per Day
             * @default 60
             */
            per_day: number;
            /**
             * Per Minute
             * @default 6
             */
            per_minute: number;
            /**
             * Tenant Per Day
             * @default 5000
             */
            tenant_per_day: number;
            /**
             * Version
             * @default 1
             */
            version: number;
        };
        /** ChatStart */
        ChatStart: {
            /**
             * Content Mode
             * @default published
             * @enum {string}
             */
            content_mode: "published" | "draft";
        };
        /**
         * ChildIn
         * @description 子設定表（級距、文件類型、繳費管道、規則、退件碼、工具、SOP 對照）的通用載體。
         *
         *     欄位集合每張表都不一樣，而且方案管理頁本來就是照 schema 產表單，所以這裡收
         *     自由欄位，由 `services/scheme.py` 決定哪些套得進去。
         */
        ChildIn: {
            /** Expected Version */
            expected_version?: number | null;
        } & {
            [key: string]: unknown;
        };
        /** ComponentIn */
        ComponentIn: {
            /**
             * Kind
             * @default other
             * @enum {string}
             */
            kind: "nav_bar" | "tab_bar" | "header" | "footer" | "other";
            /** Name */
            name: string;
            rect: components["schemas"]["ComponentRect"];
        };
        /** ComponentOut */
        ComponentOut: {
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Created By */
            created_by: string | null;
            /** Height */
            height: number;
            /** Id */
            id: string;
            /** Kind */
            kind: string;
            /** Name */
            name: string;
            /** Platform Id */
            platform_id: string;
            /** Thumb Url */
            thumb_url: string | null;
            /** Width */
            width: number;
        };
        /**
         * ComponentPatch
         * @description Rename or re-type a stored component; the snippet itself never changes.
         */
        ComponentPatch: {
            /** Kind */
            kind?: ("nav_bar" | "tab_bar" | "header" | "footer" | "other") | null;
            /** Name */
            name?: string | null;
        };
        /**
         * ComponentRect
         * @description The reviewer's rectangle on the replica, as fractions of the rendered page.
         */
        ComponentRect: {
            /** H */
            h: number;
            /** W */
            w: number;
            /** X */
            x: number;
            /** Y */
            y: number;
        };
        /** ContentDraftIn */
        ContentDraftIn: {
            /**
             * Instruction
             * @default
             */
            instruction: string;
            /**
             * Tone
             * @default
             */
            tone: string;
        };
        /**
         * DemoDataField
         * @description A value the clerk typed for this platform. Whatever they typed is what
         *     the replica shows, verbatim — there is no second kind of value (a `real`
         *     flag existed until v0.7; nobody could tell what it meant, and a value you
         *     typed yourself is by definition the one you want on the page).
         */
        DemoDataField: {
            /** Key */
            key: string;
            /** Label */
            label: string;
            /**
             * Value
             * @default
             */
            value: string;
        };
        /** DemoNotificationIn */
        DemoNotificationIn: {
            /** Case No */
            case_no: string;
            /**
             * Document Code
             * @default BILLING_STATEMENT
             */
            document_code: string;
        };
        /** DocumentIn */
        DocumentIn: {
            /**
             * Code
             * @default
             */
            code: string;
            /**
             * Content
             * @default
             */
            content: string;
            /** Expected Version */
            expected_version?: number | null;
            /** Scheme Id */
            scheme_id?: string | null;
            /**
             * Source Type
             * @default manual
             */
            source_type: string;
            /**
             * Source Url
             * @default
             */
            source_url: string;
            /**
             * Tags
             * @default []
             */
            tags: string[];
            /** Title */
            title: string;
        };
        /** DocumentOut */
        DocumentOut: {
            /** Document Type Code */
            document_type_code: string;
            /**
             * Document Type Label
             * @default
             */
            document_type_label: string;
            /** Id */
            id: string;
            /** Is Current */
            is_current: boolean;
            /** Masked */
            masked: boolean;
            /** Mime */
            mime: string;
            ocr?: components["schemas"]["OcrOut"] | null;
            /** Page Count */
            page_count: number;
            /**
             * Period Index
             * @default 1
             */
            period_index: number;
            /** Preview Key */
            preview_key?: string | null;
            /** Purged At */
            purged_at?: string | null;
            /** Revision */
            revision: number;
            /** Size */
            size: number;
            /** Supersedes Id */
            supersedes_id?: string | null;
            /** Uploaded At */
            uploaded_at?: string | null;
        };
        /** DocumentTypeSettingOut */
        DocumentTypeSettingOut: {
            /** Accepted Mime */
            accepted_mime?: string[];
            /** Code */
            code: string;
            /**
             * Hint
             * @default
             */
            hint: string;
            /**
             * Keep After Disbursed
             * @default false
             */
            keep_after_disbursed: boolean;
            /**
             * Keep Visible
             * @default
             */
            keep_visible: string;
            /**
             * Label
             * @default
             */
            label: string;
            /**
             * Max Pages
             * @default 5
             */
            max_pages: number;
            /**
             * Must Mask
             * @default false
             */
            must_mask: boolean;
            /**
             * Required
             * @default false
             */
            required: boolean;
            /**
             * Required When
             * @default
             */
            required_when: string;
            /**
             * Sort Order
             * @default 0
             */
            sort_order: number;
        };
        /**
         * DocumentUrlOut
         * @description private bucket 的短效連結（SPEC §11：5 分鐘）。
         */
        DocumentUrlOut: {
            /**
             * Expires At
             * Format: date-time
             */
            expires_at: string;
            /** Url */
            url: string;
        };
        /** DocumentsIn */
        DocumentsIn: {
            /** Documents */
            documents: {
                [key: string]: unknown;
            }[];
        };
        /** DraftIn */
        DraftIn: {
            /**
             * Draft
             * @default
             */
            draft: string;
            /** Expected Version */
            expected_version?: number | null;
        };
        /** EdgeIn */
        EdgeIn: {
            /**
             * Condition Label
             * @default
             */
            condition_label: string;
            /** Flow Id */
            flow_id: string;
            /** From Step Id */
            from_step_id: string;
            /**
             * Sort Order
             * @default 0
             */
            sort_order: number;
            /** To Step Id */
            to_step_id: string;
        };
        /** EdgeOut */
        EdgeOut: {
            /** Condition Label */
            condition_label: string;
            /** Flow Id */
            flow_id: string;
            /** From Step Id */
            from_step_id: string;
            /** Id */
            id: string;
            /** Sort Order */
            sort_order: number;
            /** To Step Id */
            to_step_id: string;
        };
        /** EdgePatch */
        EdgePatch: {
            /** Condition Label */
            condition_label?: string | null;
            /** Sort Order */
            sort_order?: number | null;
        };
        /** EvalCaseOut */
        EvalCaseOut: {
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Goal Id */
            goal_id: string | null;
            /** Id */
            id: string;
            /** Image Url */
            image_url: string;
            /** Note */
            note: string;
            /** Platform Id */
            platform_id: string;
            /** Step Id */
            step_id: string | null;
            /** Text */
            text: string;
        };
        /** EvalRunIn */
        EvalRunIn: {
            /**
             * Content Mode
             * @default draft
             * @enum {string}
             */
            content_mode: "published" | "draft";
            /**
             * Label
             * @default
             */
            label: string;
        };
        /** EvalRunOut */
        EvalRunOut: {
            /** Config */
            config: {
                [key: string]: unknown;
            };
            /** Finished At */
            finished_at: string | null;
            /** Id */
            id: string;
            /** Label */
            label: string;
            /** Results */
            results: unknown[];
            /**
             * Started At
             * Format: date-time
             */
            started_at: string;
            /** Status */
            status: string;
            /** Summary */
            summary: {
                [key: string]: unknown;
            };
        };
        /** EvaluateIn */
        EvaluateIn: {
            /**
             * Documents
             * @default []
             */
            documents: {
                [key: string]: unknown;
            }[];
            /**
             * Facts
             * @default {}
             */
            facts: {
                [key: string]: unknown;
            };
            /** Scheme */
            scheme: string;
        };
        /** EvaluateOut */
        EvaluateOut: {
            /** Findings */
            findings: components["schemas"]["app__routers__admin__schemas__FindingOut"][];
            /** Verdict */
            verdict: string;
        };
        /** EventOut */
        EventOut: {
            /** Actor Id */
            actor_id: string | null;
            /** Actor Name */
            actor_name?: string | null;
            /** Actor Type */
            actor_type: string;
            /** Created At */
            created_at?: string | null;
            /** From Status */
            from_status: string | null;
            /** Id */
            id: string;
            /** Payload */
            payload: {
                [key: string]: unknown;
            };
            /** Reason */
            reason: string;
            /** Rejection Codes */
            rejection_codes: string[];
            /** To Status */
            to_status: string;
            /** Transition Code */
            transition_code: string;
        };
        /**
         * FakeDataPick
         * @description One value kept from a replica's 假資料清單. With `key` it rewrites that
         *     示範資料 field (a shared value was corrected); without one it becomes a new
         *     field, so the rest of the batch stops inventing its own.
         */
        FakeDataPick: {
            /**
             * Key
             * @default
             */
            key: string;
            /** Label */
            label: string;
            /**
             * Replaces
             * @default
             */
            replaces: string;
            /**
             * Value
             * @default
             */
            value: string;
        };
        /** FakeDataSyncIn */
        FakeDataSyncIn: {
            /**
             * Adopt
             * @default []
             */
            adopt: components["schemas"]["FakeDataPick"][];
            /**
             * Regenerate
             * @default false
             */
            regenerate: boolean;
        };
        /** FaqIn */
        FaqIn: {
            /**
             * Active
             * @default true
             */
            active: boolean;
            /**
             * Answer
             * @default
             */
            answer: string;
            /**
             * Category
             * @default
             */
            category: string;
            /**
             * Code
             * @default
             */
            code: string;
            /** Expected Version */
            expected_version?: number | null;
            /**
             * Keywords
             * @default []
             */
            keywords: string[];
            /**
             * Priority
             * @default 0
             */
            priority: number;
            /** Question */
            question: string;
            /** Scheme Id */
            scheme_id?: string | null;
            /**
             * Source
             * @default manual
             */
            source: string;
        };
        /** FaqOut */
        FaqOut: {
            /**
             * Answer
             * @default
             */
            answer: string;
            /**
             * Category
             * @default
             */
            category: string;
            /** Id */
            id: string;
            /**
             * Priority
             * @default 0
             */
            priority: number;
            /** Question */
            question: string;
        };
        /** FindingIn */
        FindingIn: {
            /**
             * Confidence
             * @default 0
             */
            confidence: number;
            /**
             * Expected Value
             * @default
             */
            expected_value: string;
            /**
             * Extracted Value
             * @default
             */
            extracted_value: string;
            /**
             * Note
             * @default
             */
            note: string;
            /** Status */
            status: string;
        };
        /**
         * FindingOverrideIn
         * @description 人工覆寫：另寫一列 `source=reviewer`，舊的留著（SPEC §8.3）。
         */
        FindingOverrideIn: {
            /** Extracted Value */
            extracted_value?: string | null;
            /** Note */
            note?: string | null;
            /** Status */
            status: string;
        };
        /** FindingsOut */
        FindingsOut: {
            /** Findings */
            findings: components["schemas"]["app__routers__admin__schemas__FindingOut"][];
        };
        /** FlowIn */
        FlowIn: {
            /** Name */
            name: string;
            /** Platform Id */
            platform_id: string;
        };
        /** FlowOut */
        FlowOut: {
            /** Current Version */
            current_version?: number | null;
            /** Current Version Id */
            current_version_id: string | null;
            /** Drift Count */
            drift_count: number;
            /**
             * Goal Ids
             * @default []
             */
            goal_ids: string[];
            /** Id */
            id: string;
            /** Name */
            name: string;
            /** Platform Id */
            platform_id: string;
            /** Status */
            status: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
        };
        /** FlowPatch */
        FlowPatch: {
            /** Name */
            name?: string | null;
        };
        /** FlowVersionOut */
        FlowVersionOut: {
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Id */
            id: string;
            /** Published By */
            published_by: string | null;
            /** Step Count */
            step_count: number;
            /** Version */
            version: number;
        };
        /** FocusBox */
        FocusBox: {
            /** H */
            h: number;
            /** Id */
            id: string;
            /**
             * Note
             * @default
             */
            note: string;
            /**
             * Type
             * @enum {string}
             */
            type: "keep_text" | "data_region" | "block";
            /** W */
            w: number;
            /** X */
            x: number;
            /** Y */
            y: number;
        };
        /** FocusBoxesIn */
        FocusBoxesIn: {
            /** Boxes */
            boxes: components["schemas"]["FocusBox"][];
            /** Prompt Notes */
            prompt_notes?: string | null;
        };
        /** GoalIn */
        GoalIn: {
            /**
             * Aliases
             * @default []
             */
            aliases: string[];
            /**
             * Description
             * @default
             */
            description: string;
            /** Name */
            name: string;
        };
        /** GoalOut */
        GoalOut: {
            /**
             * Aliases
             * @default []
             */
            aliases: string[];
            /**
             * Description
             * @default
             */
            description: string;
            /** Id */
            id: string;
            /** Name */
            name: string;
        };
        /** HTTPValidationError */
        HTTPValidationError: {
            /** Detail */
            detail?: components["schemas"]["ValidationError"][];
        };
        /** IntentIn */
        IntentIn: {
            /** Known Context */
            known_context?: {
                [key: string]: unknown;
            } | null;
            /** Text */
            text: string;
        };
        /** LayoutCanvas */
        LayoutCanvas: {
            /** H */
            h: number;
            /**
             * Margin
             * @default 64
             */
            margin: number;
            /** W */
            w: number;
        };
        /** LayoutCanvasPatch */
        LayoutCanvasPatch: {
            /** H */
            h?: number | null;
            /** Margin */
            margin?: number | null;
            /** W */
            w?: number | null;
        };
        /**
         * LayoutFrame
         * @description The frame is a window on the replica: `x`/`y` place it, `w`/`h` size the
         *     window in canvas px (`h` 0: the replica's own height at this scale, so a
         *     template carries over to replicas of another height), `zoom` and `ox`/`oy`
         *     (replica px) move the replica behind it.
         *
         *     `align`/`valign` place the window by rule instead of by `x`/`y` — on the
         *     canvas's safe margin or its centre line. Screenshots differ in height, so
         *     a fixed `y` would put every step's window somewhere else; a rule keeps
         *     them all in the same place, and the text group anchored to the window
         *     follows it.
         */
        LayoutFrame: {
            /**
             * Align
             * @default free
             * @enum {string}
             */
            align: "free" | "left" | "center" | "right";
            /**
             * H
             * @default 0
             */
            h: number;
            /**
             * Ox
             * @default 0
             */
            ox: number;
            /**
             * Oy
             * @default 0
             */
            oy: number;
            /**
             * Valign
             * @default free
             * @enum {string}
             */
            valign: "free" | "top" | "middle" | "bottom";
            /** W */
            w: number;
            /** X */
            x: number;
            /** Y */
            y: number;
            /**
             * Zoom
             * @default 1
             */
            zoom: number;
        };
        /** LayoutFramePatch */
        LayoutFramePatch: {
            /** Align */
            align?: ("free" | "left" | "center" | "right") | null;
            /** H */
            h?: number | null;
            /** Ox */
            ox?: number | null;
            /** Oy */
            oy?: number | null;
            /** Valign */
            valign?: ("free" | "top" | "middle" | "bottom") | null;
            /** W */
            w?: number | null;
            /** X */
            x?: number | null;
            /** Y */
            y?: number | null;
            /** Zoom */
            zoom?: number | null;
        };
        /** LayoutIn */
        LayoutIn: {
            /** Items */
            items: components["schemas"]["LayoutItem"][];
        };
        /**
         * LayoutItem
         * @description A step position. Extra keys (e.g. the old `kind`) are ignored.
         */
        LayoutItem: {
            /** Id */
            id: string;
            /** X */
            x: number;
            /** Y */
            y: number;
        };
        /** LayoutList */
        LayoutList: {
            /** Gap */
            gap: number;
            /** Icon */
            icon: number;
            /** Size */
            size: number;
        };
        /** LayoutListPatch */
        LayoutListPatch: {
            /** Gap */
            gap?: number | null;
            /** Icon */
            icon?: number | null;
            /** Size */
            size?: number | null;
        };
        /**
         * LayoutMask
         * @description Dim everything but the annotated regions.
         */
        LayoutMask: {
            /**
             * Blur
             * @default 0
             */
            blur: number;
            /**
             * Enabled
             * @default false
             */
            enabled: boolean;
            /**
             * Opacity
             * @default 0.4
             */
            opacity: number;
            /**
             * Pad
             * @default 6
             */
            pad: number;
            /**
             * Radius
             * @default 12
             */
            radius: number;
        };
        /** LayoutMaskPatch */
        LayoutMaskPatch: {
            /** Blur */
            blur?: number | null;
            /** Enabled */
            enabled?: boolean | null;
            /** Opacity */
            opacity?: number | null;
            /** Pad */
            pad?: number | null;
            /** Radius */
            radius?: number | null;
        };
        /**
         * LayoutText
         * @description The text group — title, then the annotation list — placed as one block.
         *     `valign` is where it sits vertically: at its own `y` (`free`, the Apple
         *     poster way: every step's title at the same spot), or with its top,
         *     middle or bottom on the frame's. `align` is the group's axis: everything
         *     on one left edge, or the title centred and the list — as wide as its
         *     widest row, rows left-aligned — centred under it.
         */
        LayoutText: {
            /**
             * Align
             * @default left
             * @enum {string}
             */
            align: "left" | "center";
            /**
             * Gap
             * @default 48
             */
            gap: number;
            /**
             * Valign
             * @default free
             * @enum {string}
             */
            valign: "free" | "top" | "middle" | "bottom";
            /** W */
            w: number;
            /** X */
            x: number;
            /** Y */
            y: number;
        };
        /** LayoutTextPatch */
        LayoutTextPatch: {
            /** Align */
            align?: ("left" | "center") | null;
            /** Gap */
            gap?: number | null;
            /** Valign */
            valign?: ("free" | "top" | "middle" | "bottom") | null;
            /** W */
            w?: number | null;
            /** X */
            x?: number | null;
            /** Y */
            y?: number | null;
        };
        /** LayoutTitle */
        LayoutTitle: {
            /**
             * Gap
             * @default 0
             */
            gap: number;
            /**
             * Number
             * @default true
             */
            number: boolean;
            /** Size */
            size: number;
        };
        /** LayoutTitlePatch */
        LayoutTitlePatch: {
            /** Gap */
            gap?: number | null;
            /** Number */
            number?: boolean | null;
            /** Size */
            size?: number | null;
        };
        /** LoginIn */
        LoginIn: {
            /** Email */
            email: string;
            /** Password */
            password: string;
            /** Tenant Slug */
            tenant_slug?: string | null;
        };
        /** MemberIn */
        MemberIn: {
            /**
             * Email
             * Format: email
             */
            email: string;
            /**
             * Name
             * @default
             */
            name: string;
            /** Password */
            password: string;
            /**
             * Role
             * @default viewer
             * @enum {string}
             */
            role: "viewer" | "sop_editor" | "sop_reviewer" | "case_reviewer" | "case_supervisor" | "admin" | "owner";
        };
        /** MemberPatch */
        MemberPatch: {
            /** Is Active */
            is_active?: boolean | null;
            /** Name */
            name?: string | null;
            /** Password */
            password?: string | null;
            /** Role */
            role?: ("viewer" | "sop_editor" | "sop_reviewer" | "case_reviewer" | "case_supervisor" | "admin" | "owner") | null;
        };
        /** MessageIn */
        MessageIn: {
            /** Text */
            text: string;
        };
        /**
         * OcrIn
         * @description 承辦人在自己的瀏覽器重新辨識的結果（`source=reviewer`，SPEC §8.2）。
         */
        OcrIn: {
            /** Ocr */
            ocr?: {
                [key: string]: unknown;
            };
        };
        /** OcrOut */
        OcrOut: {
            /**
             * Confidence
             * @default 0
             */
            confidence: number;
            /**
             * Engine
             * @default
             */
            engine: string;
            /** Lines */
            lines?: {
                [key: string]: unknown;
            }[];
            /** Source */
            source: string;
        };
        /** PaymentChannelSettingOut */
        PaymentChannelSettingOut: {
            /** Code */
            code: string;
            /**
             * Guide Content Key
             * @default
             */
            guide_content_key: string;
            /**
             * Hint
             * @default
             */
            hint: string;
            /**
             * Label
             * @default
             */
            label: string;
            /** Required Document Type Codes */
            required_document_type_codes?: string[];
            /**
             * Sort Order
             * @default 0
             */
            sort_order: number;
        };
        /** PlatformIn */
        PlatformIn: {
            /**
             * Aliases
             * @default []
             */
            aliases: string[];
            /** Brand */
            brand: string;
            /**
             * Category
             * @default
             */
            category: string;
            /**
             * Channel
             * @default mobile_app
             * @enum {string}
             */
            channel: "mobile_app" | "web" | "desktop";
            /**
             * Demo Data
             * @default []
             */
            demo_data: components["schemas"]["DemoDataField"][];
            /** Display Name */
            display_name: string;
        };
        /** PlatformOut */
        PlatformOut: {
            /** Aliases */
            aliases: string[];
            /** Brand */
            brand: string;
            /** Category */
            category: string;
            /** Channel */
            channel: string;
            /**
             * Component Count
             * @default 0
             */
            component_count: number;
            /**
             * Demo Data
             * @default []
             */
            demo_data: components["schemas"]["DemoDataField"][];
            /** Display Name */
            display_name: string;
            /**
             * Flow Count
             * @default 0
             */
            flow_count: number;
            /** Id */
            id: string;
            /**
             * Style Doc Version
             * @default 0
             */
            style_doc_version: number;
        };
        /** PlatformPatch */
        PlatformPatch: {
            /** Aliases */
            aliases?: string[] | null;
            /** Brand */
            brand?: string | null;
            /** Category */
            category?: string | null;
            /** Channel */
            channel?: ("mobile_app" | "web" | "desktop") | null;
            /** Demo Data */
            demo_data?: components["schemas"]["DemoDataField"][] | null;
            /** Display Name */
            display_name?: string | null;
        };
        /** PlaygroundStart */
        PlaygroundStart: {
            /**
             * Content Mode
             * @default published
             * @enum {string}
             */
            content_mode: "published" | "draft";
            /**
             * External User Id
             * @default playground
             */
            external_user_id: string;
            /** Hint */
            hint?: string | null;
            /** Known Context */
            known_context?: {
                [key: string]: unknown;
            } | null;
            /**
             * Theme
             * @default light
             * @enum {string}
             */
            theme: "light" | "dark";
        };
        /**
         * PolicyIn
         * @description 客服策略 (SPEC §8.1): voice, behaviour and wording of the citizen-facing
         *     engines. Empty strings mean "use the built-in for the language".
         */
        PolicyIn: {
            /**
             * Delivery
             * @default all_at_once
             * @enum {string}
             */
            delivery: "all_at_once" | "one_by_one";
            /**
             * Extra Rules
             * @default
             */
            extra_rules: string;
            /**
             * Goal Noun
             * @default
             */
            goal_noun: string;
            /**
             * Handoff Message
             * @default
             */
            handoff_message: string;
            /**
             * Language
             * @default zh-TW
             */
            language: string;
            /**
             * Locate Low
             * @default 0.35
             */
            locate_low: number;
            /**
             * Locate Threshold
             * @default 0.6
             */
            locate_threshold: number;
            /**
             * Name
             * @default
             */
            name: string;
            /**
             * On Ambiguous
             * @default ask
             * @enum {string}
             */
            on_ambiguous: "ask" | "best_guess";
            /**
             * On Not App Screen
             * @default restart
             * @enum {string}
             */
            on_not_app_screen: "restart" | "ask_platform" | "handoff";
            /**
             * On Off Flow
             * @default restart
             * @enum {string}
             */
            on_off_flow: "restart" | "ask_goal" | "handoff";
            /**
             * On Unknown Platform
             * @default ask_platform
             * @enum {string}
             */
            on_unknown_platform: "ask_platform" | "handoff";
            /**
             * On Unreadable
             * @default retake
             * @enum {string}
             */
            on_unreadable: "retake" | "handoff";
            /** Templates */
            templates?: {
                [key: string]: string;
            };
            /**
             * Tone
             * @default
             */
            tone: string;
        };
        /** PreviewIn */
        PreviewIn: {
            /** Key */
            key: string;
            /** Text */
            text?: string | null;
        };
        /** PublishIn */
        PublishIn: {
            /** Content */
            content?: string | null;
            /** Expected Version */
            expected_version?: number | null;
        };
        /** Question */
        Question: {
            /**
             * Scheme Code
             * @default
             */
            scheme_code: string;
            /** Text */
            text: string;
        };
        /** QueueOut */
        QueueOut: {
            /** Items */
            items: components["schemas"]["ApplicationOut"][];
            /** Total */
            total: number;
        };
        /**
         * RejectionCodeSettingOut
         * @description 退件碼的後台形狀：比公開檢視多一個 `staff_label`。
         *
         *     承辦人在決策列上選的是機關內部的說法，市民收到的是 `public_what_wrong` 與
         *     `public_how_to_fix`——同一份清單，兩段不同的字。
         */
        RejectionCodeSettingOut: {
            /** Code */
            code: string;
            /**
             * Public How To Fix
             * @default
             */
            public_how_to_fix: string;
            /**
             * Public What Wrong
             * @default
             */
            public_what_wrong: string;
            /** Related Document Type Codes */
            related_document_type_codes?: string[];
            /** Related Sop Flow Ids */
            related_sop_flow_ids?: string[];
            /**
             * Staff Label
             * @default
             */
            staff_label: string;
        };
        /**
         * RenderCardsOut
         * @description A whole flow sent to the card renderer: how many steps were queued, how many had nothing to render yet.
         */
        RenderCardsOut: {
            /** Queued */
            queued: number;
            /** Skipped */
            skipped: number;
        };
        /** RenderIn */
        RenderIn: {
            /** Key */
            key: string;
            /**
             * Vars
             * @default {}
             */
            vars: {
                [key: string]: unknown;
            };
        };
        /**
         * ReorderIn
         * @description 把整個分頁重新排序：送上新的 id 順序，伺服器把 `sort_order` 重寫成 0、1、2…。
         */
        ReorderIn: {
            /** Ids */
            ids?: string[];
        };
        /** RequiredDocumentsIn */
        RequiredDocumentsIn: {
            /**
             * Paid By Proxy
             * @default false
             */
            paid_by_proxy: boolean;
            /**
             * Payment Channel Code
             * @default
             */
            payment_channel_code: string;
            /**
             * Tier Code
             * @default
             */
            tier_code: string;
        };
        /** RequiredDocumentsOut */
        RequiredDocumentsOut: {
            /** Document Type Codes */
            document_type_codes: string[];
        };
        /** ResetIn */
        ResetIn: {
            /** Expected Version */
            expected_version?: number | null;
        };
        /** ReviewIn */
        ReviewIn: {
            /**
             * Decision
             * @enum {string}
             */
            decision: "approve" | "regenerate";
            /**
             * Feedback
             * @default
             */
            feedback: string;
        };
        /** ReviewerOut */
        ReviewerOut: {
            /** Id */
            id: string;
            /**
             * Name
             * @default
             */
            name: string;
        };
        /**
         * RuleEvaluateIn
         * @description 規則試算的輸入：一組（可選的）規則、幾份 OCR 結果、申請書上的事實。
         *
         *     `rules` 省略時用方案目前存著的那一份；規則編輯器在存檔前試算時會把編輯中的
         *     版本送上來，所以這裡收的是完整的規則物件而不是 code。
         */
        RuleEvaluateIn: {
            /** Documents */
            documents?: {
                [key: string]: unknown;
            }[];
            /** Facts */
            facts?: {
                [key: string]: unknown;
            };
            /** Rules */
            rules?: {
                [key: string]: unknown;
            }[] | null;
        };
        /** RuleEvaluateOut */
        RuleEvaluateOut: {
            /** Blocking */
            blocking?: string[];
            /** Findings */
            findings?: {
                [key: string]: unknown;
            }[];
            /** Suggested Supplement */
            suggested_supplement?: string[];
            /** Verdict */
            verdict: string;
            /** Warnings */
            warnings?: string[];
        };
        /** SchemeIn */
        SchemeIn: {
            /**
             * Active
             * @default true
             */
            active: boolean;
            /** Age Max */
            age_max?: number | null;
            /** Age Min */
            age_min?: number | null;
            /**
             * Amount Note
             * @default
             */
            amount_note: string;
            /** Application End */
            application_end?: string | null;
            /**
             * Application Method
             * @default
             */
            application_method: string;
            /** Application Start */
            application_start?: string | null;
            /**
             * Category
             * @default
             */
            category: string;
            /** Code */
            code: string;
            /**
             * Contact
             * @default
             */
            contact: string;
            /**
             * Description
             * @default
             */
            description: string;
            /** Details */
            details?: {
                [key: string]: unknown;
            }[];
            /**
             * Eligibility
             * @default
             */
            eligibility: string;
            /**
             * Employment Requirement
             * @default any
             */
            employment_requirement: string;
            /** Identity Tags */
            identity_tags?: string[];
            /**
             * Image Url
             * @default
             */
            image_url: string;
            /**
             * Max Revisions
             * @default 3
             */
            max_revisions: number;
            /** Name */
            name: string;
            /**
             * Official Url
             * @default
             */
            official_url: string;
            /** Required Documents */
            required_documents?: string[];
            /**
             * Residency Requirement
             * @default
             */
            residency_requirement: string;
            /**
             * Retention Days
             * @default 90
             */
            retention_days: number;
            /**
             * Student Requirement
             * @default any
             */
            student_requirement: string;
            /**
             * Supplement Days
             * @default 14
             */
            supplement_days: number;
            /** Tags */
            tags?: string[];
        };
        /** SchemeOut */
        SchemeOut: {
            /** Active */
            active: boolean;
            /** Application End */
            application_end?: string | null;
            /** Application Start */
            application_start?: string | null;
            /** Category */
            category: string;
            /** Code */
            code: string;
            /** Id */
            id: string;
            /** Max Revisions */
            max_revisions: number;
            /** Name */
            name: string;
            /** Retention Days */
            retention_days: number;
            /** Supplement Days */
            supplement_days: number;
            /** Updated At */
            updated_at?: string | null;
            /** Version */
            version: number;
        };
        /**
         * SchemePatch
         * @description PATCH：只送要改的欄位。`expected_version` 是樂觀鎖，不送等於放棄檢查。
         */
        SchemePatch: {
            /** Active */
            active?: boolean | null;
            /** Age Max */
            age_max?: number | null;
            /** Age Min */
            age_min?: number | null;
            /** Amount Note */
            amount_note?: string | null;
            /** Application End */
            application_end?: string | null;
            /** Application Method */
            application_method?: string | null;
            /** Application Start */
            application_start?: string | null;
            /** Category */
            category?: string | null;
            /** Contact */
            contact?: string | null;
            /** Description */
            description?: string | null;
            /** Details */
            details?: {
                [key: string]: unknown;
            }[] | null;
            /** Eligibility */
            eligibility?: string | null;
            /** Employment Requirement */
            employment_requirement?: string | null;
            /** Expected Version */
            expected_version?: number | null;
            /** Identity Tags */
            identity_tags?: string[] | null;
            /** Image Url */
            image_url?: string | null;
            /** Max Revisions */
            max_revisions?: number | null;
            /** Name */
            name?: string | null;
            /** Official Url */
            official_url?: string | null;
            /** Required Documents */
            required_documents?: string[] | null;
            /** Residency Requirement */
            residency_requirement?: string | null;
            /** Retention Days */
            retention_days?: number | null;
            /** Student Requirement */
            student_requirement?: string | null;
            /** Supplement Days */
            supplement_days?: number | null;
            /** Tags */
            tags?: string[] | null;
        };
        /**
         * SchemeSettingsOut
         * @description 案件頁組表單要的方案設定（`GET /api/admin/schemes/{code}/settings`）。
         *
         *     也直接內嵌在 `ApplicationDetailOut.scheme_settings`：案件頁開一次就夠，不用為了
         *     一份退件碼清單再打一支 API。
         */
        SchemeSettingsOut: {
            /** Code */
            code: string;
            /** Document Types */
            document_types?: components["schemas"]["DocumentTypeSettingOut"][];
            /**
             * Max Revisions
             * @default 3
             */
            max_revisions: number;
            /**
             * Name
             * @default
             */
            name: string;
            /** Payment Channels */
            payment_channels?: components["schemas"]["PaymentChannelSettingOut"][];
            /** Rejection Codes */
            rejection_codes?: components["schemas"]["RejectionCodeSettingOut"][];
            /**
             * Retention Days
             * @default 90
             */
            retention_days: number;
            /**
             * Supplement Days
             * @default 14
             */
            supplement_days: number;
            /** Tiers */
            tiers?: components["schemas"]["TierSettingOut"][];
        };
        /** SchemeSummaryOut */
        SchemeSummaryOut: {
            /**
             * Active
             * @default true
             */
            active: boolean;
            /**
             * Amount Note
             * @default
             */
            amount_note: string;
            /** Application End */
            application_end?: string | null;
            /** Application Start */
            application_start?: string | null;
            /**
             * Category
             * @default
             */
            category: string;
            /** Code */
            code: string;
            /**
             * Description
             * @default
             */
            description: string;
            /** Name */
            name: string;
            /** Tags */
            tags?: string[];
        };
        /** SessionAction */
        SessionAction: {
            /**
             * Action
             * @enum {string}
             */
            action: "next" | "prev" | "choose_branch" | "choose_option" | "restart";
            /** Edge Id */
            edge_id?: string | null;
            /** Option Id */
            option_id?: string | null;
        };
        /** SessionCreate */
        SessionCreate: {
            /** External User Id */
            external_user_id: string;
            /** Hint */
            hint?: string | null;
            /** Known Context */
            known_context?: {
                [key: string]: unknown;
            } | null;
            /**
             * Theme
             * @default light
             * @enum {string}
             */
            theme: "light" | "dark";
        };
        /** SopFlowLinkIn */
        SopFlowLinkIn: {
            /** Flow Id */
            flow_id: string;
            /** Platform Id */
            platform_id: string;
        };
        /** SopFlowLinksIn */
        SopFlowLinksIn: {
            /** Links */
            links?: components["schemas"]["SopFlowLinkIn"][];
        };
        /**
         * StaffOut
         * @description `GET /api/admin/reviewers` 的一列：可以被指派案件的人。
         */
        StaffOut: {
            /**
             * Email
             * @default
             */
            email: string;
            /** Id */
            id: string;
            /**
             * Name
             * @default
             */
            name: string;
            /**
             * Role
             * @default
             */
            role: string;
        };
        /**
         * StepCardLayout
         * @description A complete layout: the tenant's template for a channel, or the built-in one.
         */
        StepCardLayout: {
            canvas: components["schemas"]["LayoutCanvas"];
            frame: components["schemas"]["LayoutFrame"];
            list: components["schemas"]["LayoutList"];
            /**
             * @default {
             *       "blur": 0,
             *       "enabled": false,
             *       "opacity": 0.4,
             *       "pad": 6,
             *       "radius": 12
             *     }
             */
            mask: components["schemas"]["LayoutMask"];
            text: components["schemas"]["LayoutText"];
            title: components["schemas"]["LayoutTitle"];
            /**
             * V
             * @constant
             */
            v: 2;
        };
        /** StepCardLayoutIn */
        StepCardLayoutIn: {
            patch?: components["schemas"]["StepCardLayoutPatch"] | null;
        };
        /**
         * StepCardLayoutPatch
         * @description What one step changes about its template — only the keys it touched,
         *     so later template edits still reach everything it left alone.
         */
        StepCardLayoutPatch: {
            canvas?: components["schemas"]["LayoutCanvasPatch"] | null;
            frame?: components["schemas"]["LayoutFramePatch"] | null;
            list?: components["schemas"]["LayoutListPatch"] | null;
            mask?: components["schemas"]["LayoutMaskPatch"] | null;
            text?: components["schemas"]["LayoutTextPatch"] | null;
            title?: components["schemas"]["LayoutTitlePatch"] | null;
            /**
             * V
             * @constant
             */
            v: 2;
        };
        /** StepDuplicateIn */
        StepDuplicateIn: {
            /** Canvas X */
            canvas_x?: number | null;
            /** Canvas Y */
            canvas_y?: number | null;
            /** Target Flow Id */
            target_flow_id: string;
        };
        /** StepIn */
        StepIn: {
            /**
             * Canvas X
             * @default 0
             */
            canvas_x: number;
            /**
             * Canvas Y
             * @default 0
             */
            canvas_y: number;
            /** Flow Id */
            flow_id: string;
            /** Goal Id */
            goal_id?: string | null;
            /**
             * Instruction
             * @default
             */
            instruction: string;
            /**
             * Is End
             * @default false
             */
            is_end: boolean;
            /**
             * Is Start
             * @default false
             */
            is_start: boolean;
            /**
             * Stuck Hint
             * @default
             */
            stuck_hint: string;
            /**
             * Title
             * @default 新步驟
             */
            title: string;
        };
        /** StepOut */
        StepOut: {
            /** Canvas X */
            canvas_x: number;
            /** Canvas Y */
            canvas_y: number;
            /** Drift Count */
            drift_count: number;
            /** Flow Id */
            flow_id: string;
            /** Goal Id */
            goal_id?: string | null;
            /** Id */
            id: string;
            /** Instruction */
            instruction: string;
            /** Is End */
            is_end: boolean;
            /** Is Start */
            is_start: boolean;
            /** Stuck Hint */
            stuck_hint: string;
            /** Title */
            title: string;
            /**
             * Variants
             * @default []
             */
            variants: components["schemas"]["VariantSummary"][];
        };
        /** StepPatch */
        StepPatch: {
            /** Canvas X */
            canvas_x?: number | null;
            /** Canvas Y */
            canvas_y?: number | null;
            /** Goal Id */
            goal_id?: string | null;
            /** Instruction */
            instruction?: string | null;
            /** Is End */
            is_end?: boolean | null;
            /** Is Start */
            is_start?: boolean | null;
            /** Stuck Hint */
            stuck_hint?: string | null;
            /** Title */
            title?: string | null;
        };
        /** StyleDocOut */
        StyleDocOut: {
            /** Ai Generated */
            ai_generated: {
                [key: string]: unknown;
            };
            /** Has Embedding */
            has_embedding: boolean;
            /** Human Notes */
            human_notes: string;
            /** Id */
            id: string;
            /** Platform Id */
            platform_id: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
            /** Version */
            version: number;
        };
        /** StyleDocPatch */
        StyleDocPatch: {
            /** Human Notes */
            human_notes: string;
        };
        /** SubmitResultOut */
        SubmitResultOut: {
            /** Case No */
            case_no: string;
            /** Findings */
            findings: components["schemas"]["app__routers__apply_schemas__FindingOut"][];
            /** Status */
            status: string;
            /** Verdict */
            verdict: string;
        };
        /** SubscriptionIn */
        SubscriptionIn: {
            /** Events */
            events: string[];
            /** Secret */
            secret?: string | null;
            /**
             * Url
             * Format: uri
             */
            url: string;
        };
        /** SubscriptionOut */
        SubscriptionOut: {
            /** Active */
            active: boolean;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Events */
            events: string[];
            /** Id */
            id: string;
            /** Secret */
            secret?: string | null;
            /** Url */
            url: string;
        };
        /** SuggestIn */
        SuggestIn: {
            /**
             * Limit
             * @default 8
             */
            limit: number;
        };
        /** SupplementItemIn */
        SupplementItemIn: {
            /** Document Type Code */
            document_type_code?: string | null;
            /**
             * Note
             * @default
             */
            note: string;
            /**
             * Period Index
             * @default 1
             */
            period_index: number;
            /**
             * Rejection Code
             * @default OTHER
             */
            rejection_code: string;
        };
        /** SupplementItemOut */
        SupplementItemOut: {
            /** Document Type Code */
            document_type_code?: string | null;
            /**
             * Note
             * @default
             */
            note: string;
            /**
             * Period Index
             * @default 1
             */
            period_index: number;
            /**
             * Rejection Code
             * @default
             */
            rejection_code: string;
        };
        /** TenantLayoutIn */
        TenantLayoutIn: {
            /**
             * Channel
             * @enum {string}
             */
            channel: "mobile_app" | "web";
            layout?: components["schemas"]["StepCardLayout"] | null;
        };
        /** TenantOut */
        TenantOut: {
            /** Id */
            id: string;
            /** Name */
            name: string;
            /**
             * Settings
             * @default {}
             */
            settings: {
                [key: string]: unknown;
            };
            /** Slug */
            slug: string;
        };
        /** TierSettingOut */
        TierSettingOut: {
            /**
             * Cap Amount
             * @default 0
             */
            cap_amount: number;
            /** Code */
            code: string;
            /**
             * Label
             * @default
             */
            label: string;
            /** Required Proof Doc Types */
            required_proof_doc_types?: string[];
            /**
             * Sort Order
             * @default 0
             */
            sort_order: number;
            /**
             * Subsidy Rate
             * @default 0
             */
            subsidy_rate: number;
        };
        /** TokenOut */
        TokenOut: {
            /** Access Token */
            access_token: string;
            /**
             * Token Type
             * @default bearer
             */
            token_type: string;
        };
        /** ToolInquiryIn */
        ToolInquiryIn: {
            /** Name */
            name: string;
        };
        /** ToolInquiryOut */
        ToolInquiryOut: {
            /** Tool Id */
            tool_id: string | null;
        };
        /**
         * ToolResolveIn
         * @description 處理一筆待審工具。`merge_into_id` 有值時 `status` 不生效——併入就是併入。
         */
        ToolResolveIn: {
            /** Merge Into Id */
            merge_into_id?: string | null;
            /**
             * Status
             * @default APPROVED
             * @enum {string}
             */
            status: "APPROVED" | "REJECTED" | "PENDING";
            /**
             * Verdict Note
             * @default
             */
            verdict_note: string;
        };
        /** TransitionResultOut */
        TransitionResultOut: {
            /** Events */
            events: components["schemas"]["EventOut"][];
            /** Status */
            status: string;
        };
        /** UnfinishedStep */
        UnfinishedStep: {
            /** Step Id */
            step_id: string;
            /** Theme */
            theme: string;
        };
        /** UserOut */
        UserOut: {
            /** Created At */
            created_at?: string | null;
            /** Email */
            email: string;
            /** Id */
            id: string;
            /**
             * Is Active
             * @default true
             */
            is_active: boolean;
            /** Name */
            name: string;
            /** Role */
            role: string;
            /** Tenant Id */
            tenant_id: string;
        };
        /** ValidationError */
        ValidationError: {
            /** Context */
            ctx?: Record<string, never>;
            /** Input */
            input?: unknown;
            /** Location */
            loc: (string | number)[];
            /** Message */
            msg: string;
            /** Error Type */
            type: string;
        };
        /** ValidationOut */
        ValidationOut: {
            /** Errors */
            errors: string[];
            /** Ok */
            ok: boolean;
            /** Publish Errors */
            publish_errors: string[];
            /** Publishable */
            publishable: boolean;
            /**
             * Unfinished
             * @default []
             */
            unfinished: components["schemas"]["UnfinishedStep"][];
        };
        /** VariantOut */
        VariantOut: {
            /** Annotations */
            annotations: {
                [key: string]: unknown;
            }[];
            /** Attempts */
            attempts: number;
            /** Check Report */
            check_report: {
                [key: string]: unknown;
            } | null;
            /** Description */
            description: string;
            /** Drift Count */
            drift_count: number;
            /** Error */
            error: string;
            /** Fake Data */
            fake_data: unknown[];
            /** Fake Data Reviewed */
            fake_data_reviewed: boolean;
            /** Focus Boxes */
            focus_boxes: {
                [key: string]: unknown;
            }[];
            /** Has Original */
            has_original: boolean;
            /** Id */
            id: string;
            /** Kept Texts */
            kept_texts: unknown[];
            /** Original Height */
            original_height: number;
            /** Original Version */
            original_version: string | null;
            /** Original Width */
            original_width: number;
            /** Progress */
            progress: string;
            /** Prompt Notes */
            prompt_notes: string;
            /** Replica Height */
            replica_height: number;
            /** Replica Png Url */
            replica_png_url: string | null;
            /** Replica Version */
            replica_version: string | null;
            /** Replica Width */
            replica_width: number;
            /** Review History */
            review_history: unknown[];
            /** Status */
            status: string;
            /** Step Id */
            step_id: string;
            /** Stepcard Layout */
            stepcard_layout: {
                [key: string]: unknown;
            } | null;
            /** Stepcard Preview Url */
            stepcard_preview_url: string | null;
            /** Stepcard Thumb Url */
            stepcard_thumb_url: string | null;
            /** Stepcard Url */
            stepcard_url: string | null;
            /** Structure */
            structure: {
                [key: string]: unknown;
            } | null;
            /** Theme */
            theme: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
        };
        /** VariantSummary */
        VariantSummary: {
            /**
             * Attempts
             * @default 0
             */
            attempts: number;
            /**
             * Drift Count
             * @default 0
             */
            drift_count: number;
            /**
             * Error
             * @default
             */
            error: string;
            /**
             * Has Original
             * @default false
             */
            has_original: boolean;
            /** Id */
            id: string;
            /** Original Version */
            original_version?: string | null;
            /**
             * Progress
             * @default
             */
            progress: string;
            /** Replica Png Url */
            replica_png_url?: string | null;
            /** Replica Version */
            replica_version?: string | null;
            /** Status */
            status: string;
            /** Stepcard Preview Url */
            stepcard_preview_url?: string | null;
            /** Stepcard Thumb Url */
            stepcard_thumb_url?: string | null;
            /** Stepcard Url */
            stepcard_url?: string | null;
            /** Theme */
            theme: string;
        };
        /** VerifyIn */
        VerifyIn: {
            /** Case No */
            case_no: string;
            /** Last4 */
            last4: string;
        };
        /** VerifyOut */
        VerifyOut: {
            /** Case No */
            case_no: string;
            /**
             * Expires At
             * Format: date-time
             */
            expires_at: string;
            /** Token */
            token: string;
        };
        /** WithdrawOut */
        WithdrawOut: {
            /** Status */
            status: string;
        };
        /**
         * FindingOut
         * @description 契約 §Finding + 案件頁需要的落地欄位。
         *
         *     `superseded=True` 代表這一列已經被同一條規則更新的判定取代，只留在歷史裡。
         */
        app__routers__admin__schemas__FindingOut: {
            /** Bbox */
            bbox?: {
                [key: string]: number;
            } | null;
            /** Confidence */
            confidence?: number | null;
            /** Decided At */
            decided_at?: string | null;
            /** Document Id */
            document_id?: string | null;
            /** Document Type Code */
            document_type_code?: string | null;
            /** Expected Value */
            expected_value?: string | null;
            /** Extracted Value */
            extracted_value?: string | null;
            /** Id */
            id: string;
            /** Note */
            note?: string | null;
            /** Note Text */
            note_text?: string | null;
            reviewer?: components["schemas"]["ReviewerOut"] | null;
            /** Rule Code */
            rule_code: string;
            /** Rule Id */
            rule_id?: string | null;
            /** Source */
            source: string;
            /** Status */
            status: string;
            /** Suggested Supplement */
            suggested_supplement?: string[] | null;
            /**
             * Superseded
             * @default false
             */
            superseded: boolean;
        };
        /** TransitionIn */
        app__routers__admin__schemas__TransitionIn: {
            /** Code */
            code: string;
            /** Payload */
            payload?: {
                [key: string]: unknown;
            };
            /**
             * Reason
             * @default
             */
            reason: string;
            /** Rejection Codes */
            rejection_codes?: string[];
            /** Supplement Deadline */
            supplement_deadline?: string | null;
            /** Supplement Items */
            supplement_items?: components["schemas"]["SupplementItemIn"][];
        };
        /**
         * FindingOut
         * @description 與 `@maydru/review-rules` 的 Finding 同形狀（契約 §Finding）。
         */
        app__routers__apply_schemas__FindingOut: {
            /** Bbox */
            bbox?: {
                [key: string]: number;
            } | null;
            /** Confidence */
            confidence?: number | null;
            /** Document Type Code */
            document_type_code?: string | null;
            /** Expected Value */
            expected_value?: string | null;
            /** Extracted Value */
            extracted_value?: string | null;
            /** Note */
            note?: string | null;
            /** Rule Code */
            rule_code: string;
            /** Status */
            status: string;
            /** Suggested Supplement */
            suggested_supplement?: string[] | null;
        };
        /** TextIn */
        app__routers__public_resources__TextIn: {
            /**
             * Limit
             * @default 3
             */
            limit: number;
            /** Text */
            text: string;
        };
        /** TransitionIn */
        app__routers__public_resources__TransitionIn: {
            /**
             * Applicant Token
             * @default
             */
            applicant_token: string;
            /**
             * Payload
             * @default {}
             */
            payload: {
                [key: string]: unknown;
            };
            /**
             * Reason
             * @default
             */
            reason: string;
            /**
             * Rejection Codes
             * @default []
             */
            rejection_codes: string[];
            /**
             * Supplement Items
             * @default []
             */
            supplement_items: {
                [key: string]: unknown;
            }[];
            /** Transition Code */
            transition_code: string;
        };
        /** TextIn */
        app__schemas__TextIn: {
            /** Text */
            text: string;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    list_queue_api_admin_applications_get: {
        parameters: {
            query?: {
                status?: string[] | null;
                /** @description 方案代碼 */
                scheme?: string | null;
                /** @description 承辦人 id */
                assigned?: string | null;
                /** @description 案號、姓名或工具名稱 */
                q?: string;
                page?: number;
                page_size?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["QueueOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_application_api_admin_applications__case_no__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                case_no: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApplicationDetailOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    assign_api_admin_applications__case_no__assign_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                case_no: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AssignIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AssignOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    put_reviewer_ocr_api_admin_applications__case_no__documents__doc_id__ocr_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                case_no: string;
                doc_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["OcrIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FindingsOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    document_url_api_admin_applications__case_no__documents__doc_id__url_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                case_no: string;
                doc_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentUrlOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    evaluate_case_api_admin_applications__case_no__evaluate_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                case_no: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EvaluateOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    override_finding_api_admin_applications__case_no__findings__rule_code__put: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                case_no: string;
                rule_code: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FindingOverrideIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FindingsOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    post_transition_api_admin_applications__case_no__transitions_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                case_no: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["app__routers__admin__schemas__TransitionIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TransitionResultOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_audit_logs_api_admin_audit_logs_get: {
        parameters: {
            query?: {
                action?: string;
                target_type?: string;
                actor?: string;
                offset?: number;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_contents_api_admin_contents_get: {
        parameters: {
            query?: {
                category?: string | null;
                q?: string | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    categories_api_admin_contents_categories_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    }[];
                };
            };
        };
    };
    preview_api_admin_contents_preview_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PreviewIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_content_api_admin_contents__key__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                key: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    save_draft_api_admin_contents__key__put: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                key: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DraftIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    publish_api_admin_contents__key__publish_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                key: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PublishIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    reset_api_admin_contents__key__reset_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                key: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ResetIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    draft_content_api_admin_copilot_contents__key__draft_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                key: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["ContentDraftIn"] | null;
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_faq_suggestions_api_admin_copilot_faq_suggestions_get: {
        parameters: {
            query?: {
                status?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    generate_faq_suggestions_api_admin_copilot_faq_suggestions_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["SuggestIn"] | null;
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    accept_faq_suggestion_api_admin_copilot_faq_suggestions__suggestion_id__accept_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                suggestion_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    dismiss_faq_suggestion_api_admin_copilot_faq_suggestions__suggestion_id__dismiss_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                suggestion_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    scheme_drafts_api_admin_copilot_schemes__code__drafts_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                code: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_faqs_api_admin_faqs_get: {
        parameters: {
            query?: {
                category?: string | null;
                q?: string | null;
                active_only?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_faq_api_admin_faqs_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FaqIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_faq_api_admin_faqs__faq_id__put: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                faq_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FaqIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_faq_api_admin_faqs__faq_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                faq_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    set_faq_status_api_admin_faqs__faq_id__status_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                faq_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ActiveIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    read_settings_api_admin_help_chat_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ChatSettings"];
                };
            };
        };
    };
    write_settings_api_admin_help_chat_put: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ChatSettings"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ChatSettings"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_documents_api_admin_knowledge_get: {
        parameters: {
            query?: {
                q?: string | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_document_api_admin_knowledge_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DocumentIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_document_api_admin_knowledge__document_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                document_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_document_api_admin_knowledge__document_id__put: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                document_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DocumentIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_document_api_admin_knowledge__document_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                document_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    feedback_api_admin_line_feedback_get: {
        parameters: {
            query?: {
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    notifications_api_admin_line_notifications_get: {
        parameters: {
            query?: {
                status?: string | null;
                case_no?: string | null;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    send_demo_notification_api_admin_line_notifications_demo_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DemoNotificationIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    richmenu_status_api_admin_line_richmenu_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
        };
    };
    richmenu_remove_api_admin_line_richmenu_delete: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
        };
    };
    richmenu_image_api_admin_line_richmenu_image_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "image/jpeg": unknown;
                };
            };
        };
    };
    richmenu_sync_api_admin_line_richmenu_sync_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "multipart/form-data": components["schemas"]["Body_richmenu_sync_api_admin_line_richmenu_sync_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    sync_logs_api_admin_line_sync_logs_get: {
        parameters: {
            query?: {
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    unmatched_api_admin_line_unmatched_get: {
        parameters: {
            query?: {
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    dismiss_unmatched_api_admin_line_unmatched__message_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                message_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_media_api_admin_media_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
        };
    };
    upload_api_admin_media_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_upload_api_admin_media_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_api_admin_media__media_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                media_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_reviewers_api_admin_reviewers_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StaffOut"][];
                };
            };
        };
    };
    list_schemes_api_admin_schemes_get: {
        parameters: {
            query?: {
                active?: boolean | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SchemeOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_scheme_api_admin_schemes_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SchemeIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SchemeOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_scheme_api_admin_schemes__code__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                code: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_scheme_api_admin_schemes__code__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                code: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    patch_scheme_api_admin_schemes__code__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                code: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SchemePatch"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SchemeOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_sop_flows_api_admin_schemes__code__document_types__dt_code__sop_flows_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                code: string;
                dt_code: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    }[];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    put_sop_flows_api_admin_schemes__code__document_types__dt_code__sop_flows_put: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                code: string;
                dt_code: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SopFlowLinksIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    }[];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_pending_tools_api_admin_schemes__code__eligible_tools_pending_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                code: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    }[];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    resolve_eligible_tool_api_admin_schemes__code__eligible_tools__tool_id__resolve_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                code: string;
                tool_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ToolResolveIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    evaluate_review_rules_api_admin_schemes__code__review_rules_evaluate_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                code: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RuleEvaluateIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RuleEvaluateOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_scheme_settings_api_admin_schemes__code__settings_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                code: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SchemeSettingsOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_children_api_admin_schemes__code___kind__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                code: string;
                kind: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_child_api_admin_schemes__code___kind__post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                code: string;
                kind: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ChildIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    reorder_children_api_admin_schemes__code___kind__reorder_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                code: string;
                kind: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReorderIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    }[];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_child_api_admin_schemes__code___kind___child_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                code: string;
                kind: string;
                child_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    patch_child_api_admin_schemes__code___kind___child_id__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                code: string;
                kind: string;
                child_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ChildIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_keys_api_api_keys_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiKeyOut"][];
                };
            };
        };
    };
    create_key_api_api_keys_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ApiKeyIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiKeyOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_key_api_api_keys__key_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                key_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    patch_key_api_api_keys__key_id__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                key_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ApiKeyPatch"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiKeyOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_application_api_apply_applications_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_create_application_api_apply_applications_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SubmitResultOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_case_api_apply_applications__case_no__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                case_no: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CasePublicOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    add_supplement_api_apply_applications__case_no__documents_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                case_no: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "multipart/form-data": components["schemas"]["Body_add_supplement_api_apply_applications__case_no__documents_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SubmitResultOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    withdraw_api_apply_applications__case_no__withdraw_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                case_no: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WithdrawOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_faqs_api_apply_faqs_get: {
        parameters: {
            query?: {
                q?: string;
                scheme?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FaqOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    ask_api_apply_help_chat_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Question"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ChatReply"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_schemes_api_apply_schemes_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SchemeSummaryOut"][];
                };
            };
        };
    };
    get_scheme_api_apply_schemes__code__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                code: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    required_documents_api_apply_schemes__code__required_documents_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                code: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RequiredDocumentsIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RequiredDocumentsOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    inquire_tool_api_apply_schemes__code__tool_inquiries_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                code: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ToolInquiryIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ToolInquiryOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    verify_api_apply_verify_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["VerifyIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VerifyOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    bootstrap_api_auth_bootstrap_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BootstrapIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TokenOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    bootstrap_status_api_auth_bootstrap_status_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
        };
    };
    login_api_auth_login_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LoginIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TokenOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    me_api_auth_me_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserOut"];
                };
            };
        };
    };
    get_canvas_api_canvas_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CanvasOut"];
                };
            };
        };
    };
    save_layout_api_canvas_layout_put: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LayoutIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_component_api_components__component_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                component_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    patch_component_api_components__component_id__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                component_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ComponentPatch"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ComponentOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    component_thumb_api_components__component_id__thumb_png_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                component_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_contents_api_contents_get: {
        parameters: {
            query?: {
                /** @description 逗號分隔的 content key */
                keys?: string | null;
                category?: string | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    render_api_contents_render_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    [key: string]: unknown;
                };
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    summary_api_dashboard_summary_get: {
        parameters: {
            query?: {
                days?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_edge_api_edges_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EdgeIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EdgeOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_edge_api_edges__edge_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                edge_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    patch_edge_api_edges__edge_id__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                edge_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EdgePatch"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EdgeOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_cases_api_evals_cases_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EvalCaseOut"][];
                };
            };
        };
    };
    create_case_api_evals_cases_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_create_case_api_evals_cases_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EvalCaseOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_case_api_evals_cases__case_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                case_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    case_image_api_evals_cases__case_id__image_png_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                case_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_runs_api_evals_runs_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EvalRunOut"][];
                };
            };
        };
    };
    start_run_api_evals_runs_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EvalRunIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EvalRunOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_run_api_evals_runs__run_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                run_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EvalRunOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_flow_api_flows_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FlowIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FlowOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_flow_api_flows__flow_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                flow_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    patch_flow_api_flows__flow_id__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                flow_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FlowPatch"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FlowOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    publish_api_flows__flow_id__publish_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                flow_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FlowOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    render_cards_api_flows__flow_id__render_cards_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                flow_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RenderCardsOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    rollback_api_flows__flow_id__rollback__version_id__post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                flow_id: string;
                version_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FlowOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    unpublish_api_flows__flow_id__unpublish_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                flow_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FlowOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    validate_api_flows__flow_id__validate_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                flow_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    versions_api_flows__flow_id__versions_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                flow_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FlowVersionOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_goals_api_goals_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GoalOut"][];
                };
            };
        };
    };
    create_goal_api_goals_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["GoalIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GoalOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_goal_api_goals__goal_id__put: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                goal_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["GoalIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GoalOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_goal_api_goals__goal_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                goal_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_members_api_members_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserOut"][];
                };
            };
        };
    };
    create_member_api_members_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MemberIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_member_api_members__member_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                member_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    patch_member_api_members__member_id__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                member_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MemberPatch"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    annotation_types_api_meta_annotation_types_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
        };
    };
    list_platforms_api_platforms_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlatformOut"][];
                };
            };
        };
    };
    create_platform_api_platforms_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PlatformIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlatformOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_platform_api_platforms__platform_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                platform_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    patch_platform_api_platforms__platform_id__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                platform_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PlatformPatch"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlatformOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_components_api_platforms__platform_id__components_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                platform_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ComponentOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_style_doc_api_platforms__platform_id__style_doc_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                platform_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StyleDocOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    patch_style_doc_api_platforms__platform_id__style_doc_patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                platform_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["StyleDocPatch"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StyleDocOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    style_doc_versions_api_platforms__platform_id__style_doc_versions_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                platform_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    chat_start_api_playground_chats_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ChatStart"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    chat_status_api_playground_chats__chat_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                chat_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    chat_message_api_playground_chats__chat_id__messages_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                chat_id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "multipart/form-data": components["schemas"]["Body_chat_message_api_playground_chats__chat_id__messages_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    start_api_playground_sessions_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PlaygroundStart"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    status_api_playground_sessions__session_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    action_api_playground_sessions__session_id__actions_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ActionIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    text_api_playground_sessions__session_id__messages_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["app__schemas__TextIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    screenshot_api_playground_sessions__session_id__screenshots_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_screenshot_api_playground_sessions__session_id__screenshots_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    review_queue_api_review_queue_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
        };
    };
    catalog_document_types_api_sop_catalog_document_types_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: string;
                    }[];
                };
            };
        };
    };
    catalog_flows_api_sop_catalog_flows_get: {
        parameters: {
            query?: {
                platform_id?: string | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    }[];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    catalog_goals_api_sop_catalog_goals_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    }[];
                };
            };
        };
    };
    catalog_platforms_api_sop_catalog_platforms_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    }[];
                };
            };
        };
    };
    document_type_flows_api_sop_document_types__code__flows_get: {
        parameters: {
            query?: {
                platform_id?: string | null;
                scheme?: string;
                rejection_code?: string;
            };
            header?: never;
            path: {
                code: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    }[];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    flow_steps_api_sop_flows__flow_id__steps_get: {
        parameters: {
            query?: {
                goal_id?: string | null;
                from_step_id?: string | null;
                theme?: "light" | "dark";
                number_from?: number;
            };
            header?: never;
            path: {
                flow_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    locate_api_sop_locate_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_locate_api_sop_locate_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_step_api_steps_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["StepIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StepOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_step_api_steps__step_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                step_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StepOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_step_api_steps__step_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                step_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    patch_step_api_steps__step_id__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                step_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["StepPatch"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StepOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    duplicate_step_api_steps__step_id__duplicate_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                step_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["StepDuplicateIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StepOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_tenant_api_tenant_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TenantOut"];
                };
            };
        };
    };
    get_assistant_settings_api_tenant_assistant_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
        };
    };
    get_policy_api_tenant_policy_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
        };
    };
    set_policy_api_tenant_policy_put: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PolicyIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    set_tenant_layout_api_tenant_stepcard_layout_put: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TenantLayoutIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TenantOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_variant_api_variants__variant_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                variant_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VariantOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    set_annotations_api_variants__variant_id__annotations_put: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                variant_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AnnotationsIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VariantOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    card_preview_api_variants__variant_id__card_preview_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                variant_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CardPreviewIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CardPreviewOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_component_api_variants__variant_id__components_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                variant_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ComponentIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ComponentOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    sync_fake_data_api_variants__variant_id__fake_data_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                variant_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FakeDataSyncIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VariantOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    set_focus_boxes_api_variants__variant_id__focus_boxes_put: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                variant_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FocusBoxesIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VariantOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    upload_original_api_variants__variant_id__original_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                variant_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_upload_original_api_variants__variant_id__original_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VariantOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_original_api_variants__variant_id__original_delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                variant_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VariantOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_original_api_variants__variant_id__original_png_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                variant_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    process_api_variants__variant_id__process_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                variant_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VariantOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    render_card_api_variants__variant_id__render_card_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                variant_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VariantOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    advanced_edit_api_variants__variant_id__replica_html_put: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                variant_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdvancedEditIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VariantOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    replica_html_api_variants__variant_id__replica_html_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                variant_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    replica_png_api_variants__variant_id__replica_png_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                variant_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    review_api_variants__variant_id__review_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                variant_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReviewIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VariantOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    set_layout_api_variants__variant_id__stepcard_layout_put: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                variant_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["StepCardLayoutIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VariantOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    health_health_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
        };
    };
    webhook_line_webhook_post: {
        parameters: {
            query?: never;
            header?: {
                "X-Line-Signature"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    media_media__key__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                key: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_application_v1_applications_post: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ApplicationIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_application_v1_applications__case_no__get: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path: {
                case_no: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    add_documents_v1_applications__case_no__documents_post: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path: {
                case_no: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DocumentsIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    application_events_v1_applications__case_no__events_get: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path: {
                case_no: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    findings_v1_applications__case_no__findings_get: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path: {
                case_no: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_finding_v1_applications__case_no__findings__rule_code__put: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path: {
                case_no: string;
                rule_code: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FindingIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    transition_application_v1_applications__case_no__transitions_post: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path: {
                case_no: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["app__routers__public_resources__TransitionIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    catalog_document_types_v1_catalog_document_types_get: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    catalog_flows_v1_catalog_flows_get: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    catalog_cards_v1_catalog_flows__flow_id__cards_get: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path: {
                flow_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    catalog_goals_v1_catalog_goals_get: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    catalog_platforms_v1_catalog_platforms_get: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_chat_v1_chat_post: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ChatCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    chat_status_v1_chat__chat_id__get: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path: {
                chat_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    chat_message_v1_chat__chat_id__messages_post: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path: {
                chat_id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "multipart/form-data": components["schemas"]["Body_chat_message_v1_chat__chat_id__messages_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_contents_v1_contents_get: {
        parameters: {
            query?: {
                category?: string | null;
            };
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    render_content_v1_contents_render_post: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RenderIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_content_v1_contents__key__get: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path: {
                key: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    document_type_flows_v1_document_types__code__flows_get: {
        parameters: {
            query?: {
                platform_id?: string | null;
                scheme?: string;
                rejection_code?: string;
            };
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path: {
                code: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    search_faqs_v1_faqs_search_post: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["app__routers__public_resources__TextIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    flow_steps_v1_flows__flow_id__steps_get: {
        parameters: {
            query?: {
                goal_id?: string | null;
                from_step_id?: string | null;
                theme?: "light" | "dark";
                number_from?: number;
            };
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path: {
                flow_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    parse_intent_v1_intent_post: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["IntentIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    classify_intent_v1_intent_classify_post: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["app__routers__public_resources__TextIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    locate_screenshot_v1_locate_post: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_locate_screenshot_v1_locate_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    notifications_v1_notifications_get: {
        parameters: {
            query?: {
                case_no?: string | null;
            };
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    evaluate_v1_review_evaluate_post: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EvaluateIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    review_rules_v1_review_rules_get: {
        parameters: {
            query: {
                scheme: string;
            };
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_schemes_v1_schemes_get: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_scheme_v1_schemes__code__get: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path: {
                code: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_session_v1_sessions_post: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SessionCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_session_v1_sessions__session_id__get: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    send_action_v1_sessions__session_id__actions_post: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SessionAction"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    send_message_v1_sessions__session_id__messages_post: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MessageIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    send_screenshot_v1_sessions__session_id__screenshots_post: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_send_screenshot_v1_sessions__session_id__screenshots_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    sop_catalog_document_types_v1_sop_catalog_document_types_get: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    sop_catalog_flows_v1_sop_catalog_flows_get: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    sop_catalog_cards_v1_sop_catalog_flows__flow_id__cards_get: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path: {
                flow_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    sop_catalog_goals_v1_sop_catalog_goals_get: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    sop_catalog_platforms_v1_sop_catalog_platforms_get: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    sop_create_chat_v1_sop_chat_post: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ChatCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    sop_chat_status_v1_sop_chat__chat_id__get: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path: {
                chat_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    sop_chat_message_v1_sop_chat__chat_id__messages_post: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path: {
                chat_id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "multipart/form-data": components["schemas"]["Body_sop_chat_message_v1_sop_chat__chat_id__messages_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    sop_document_type_flows_v1_sop_document_types__code__flows_get: {
        parameters: {
            query?: {
                platform_id?: string | null;
                scheme?: string;
                rejection_code?: string;
            };
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path: {
                code: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    sop_flow_steps_v1_sop_flows__flow_id__steps_get: {
        parameters: {
            query?: {
                goal_id?: string | null;
                from_step_id?: string | null;
                theme?: "light" | "dark";
                number_from?: number;
            };
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path: {
                flow_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    sop_parse_intent_v1_sop_intent_post: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["IntentIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    sop_locate_screenshot_v1_sop_locate_post: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_sop_locate_screenshot_v1_sop_locate_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    sop_create_session_v1_sop_sessions_post: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SessionCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    sop_get_session_v1_sop_sessions__session_id__get: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    sop_send_action_v1_sop_sessions__session_id__actions_post: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SessionAction"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    sop_send_message_v1_sop_sessions__session_id__messages_post: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MessageIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    sop_send_screenshot_v1_sop_sessions__session_id__screenshots_post: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_sop_send_screenshot_v1_sop_sessions__session_id__screenshots_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_deliveries_v1_webhook_deliveries_get: {
        parameters: {
            query?: {
                subscription_id?: string | null;
            };
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    resend_delivery_v1_webhook_deliveries__delivery_id__resend_post: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path: {
                delivery_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_subscriptions_v1_webhooks_get: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SubscriptionOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_subscription_v1_webhooks_post: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SubscriptionIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SubscriptionOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_subscription_v1_webhooks__subscription_id__delete: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path: {
                subscription_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    test_subscription_v1_webhooks__subscription_id__test_post: {
        parameters: {
            query?: never;
            header?: {
                Authorization?: string | null;
                "X-API-Key"?: string | null;
            };
            path: {
                subscription_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
}
