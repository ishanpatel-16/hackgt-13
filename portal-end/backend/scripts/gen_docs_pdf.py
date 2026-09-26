"""Generate portal models + API PDF docs. Run: python3 scripts/gen_docs_pdf.py"""
from pathlib import Path

from fpdf import FPDF

OUT = Path(__file__).resolve().parent.parent / "docs" / "portal_api_and_models.pdf"


class Doc(FPDF):
    def header(self):
        if self.page_no() == 1:
            return
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(100, 100, 100)
        self.cell(0, 6, "net0 Portal Backend - Models & API Reference", align="L")
        self.ln(8)
        self.set_text_color(0, 0, 0)

    def footer(self):
        self.set_y(-12)
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(120, 120, 120)
        self.cell(0, 8, f"Page {self.page_no()}/{{nb}}", align="C")

    def h1(self, text: str) -> None:
        self.ln(2)
        self.set_font("Helvetica", "B", 18)
        self.set_text_color(20, 40, 70)
        self.multi_cell(0, 10, text)
        self.ln(1)
        self.set_text_color(0, 0, 0)

    def h2(self, text: str) -> None:
        self.ln(4)
        self.set_font("Helvetica", "B", 13)
        self.set_text_color(30, 60, 100)
        self.multi_cell(0, 7, text)
        self.ln(1)
        self.set_text_color(0, 0, 0)

    def h3(self, text: str) -> None:
        self.ln(2)
        self.set_font("Helvetica", "B", 11)
        self.multi_cell(0, 6, text)

    def body(self, text: str) -> None:
        self.set_font("Helvetica", "", 10)
        self.multi_cell(0, 5.5, text)
        self.ln(1)

    def bullet(self, text: str) -> None:
        self.set_font("Helvetica", "", 10)
        self.set_x(self.l_margin)
        self.cell(5, 5.5, "-")
        self.multi_cell(0, 5.5, text)

    def field(self, name: str, typ: str, desc: str) -> None:
        self.set_x(self.l_margin)
        self.set_font("Helvetica", "B", 9)
        self.cell(0, 5, f"{name}  ({typ})", new_x="LMARGIN", new_y="NEXT")
        self.set_x(self.l_margin + 4)
        self.set_font("Helvetica", "", 9)
        self.multi_cell(0, 4.8, desc)
        self.ln(0.5)

    def route(self, method: str, path: str, desc: str, details: list[str] | None = None) -> None:
        colors = {
            "GET": (25, 110, 60),
            "POST": (30, 80, 160),
            "PATCH": (150, 90, 20),
            "PUT": (120, 60, 140),
            "DELETE": (160, 40, 40),
        }
        r, g, b = colors.get(method, (0, 0, 0))
        self.set_x(self.l_margin)
        self.set_font("Helvetica", "B", 10)
        self.set_text_color(r, g, b)
        method_w = self.get_string_width(method + " ") + 1
        self.cell(method_w, 6, method)
        self.set_text_color(0, 0, 0)
        self.set_font("Courier", "B", 9)
        self.cell(0, 6, path, new_x="LMARGIN", new_y="NEXT")
        self.set_x(self.l_margin + 4)
        self.set_font("Helvetica", "", 9)
        self.multi_cell(0, 4.8, desc)
        if details:
            for d in details:
                self.set_x(self.l_margin + 8)
                self.set_font("Helvetica", "", 8)
                self.set_text_color(60, 60, 60)
                self.multi_cell(0, 4.5, "- " + d)
            self.set_text_color(0, 0, 0)
        self.ln(1.5)


def build() -> Path:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    pdf = Doc(format="Letter")
    pdf.alias_nb_pages()
    pdf.set_auto_page_break(auto=True, margin=16)
    pdf.set_left_margin(16)
    pdf.set_right_margin(16)
    pdf.set_top_margin(16)
    pdf.add_page()
    pdf.set_x(pdf.l_margin)

    pdf.set_font("Helvetica", "B", 22)
    pdf.set_text_color(20, 40, 70)
    pdf.cell(0, 11, "net0 Portal Backend", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 13)
    pdf.cell(0, 7, "Database Models & API Routes Reference", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(1)
    pdf.set_font("Helvetica", "I", 10)
    pdf.set_text_color(90, 90, 90)
    pdf.cell(0, 5, "portal-end/backend  |  HackGT 13  |  September 2026", new_x="LMARGIN", new_y="NEXT")
    pdf.set_text_color(0, 0, 0)
    pdf.ln(3)
    pdf.body(
        "This document describes the SQLAlchemy models (SQLite by default) and the "
        "FastAPI HTTP routes under portal-end/backend/routes. Uplink packets from the "
        "mesh gateway also write into these tables via packets/packet_handler.py. AI "
        "enrichment fills ai_* fields asynchronously after a report is saved."
    )

    pdf.h2("1. Entity relationship overview")
    pdf.body(
        "users (1) --- (*) reports\n"
        "users (1) --- (*) messages\n"
        "nodes (standalone; updated by heartbeats)\n\n"
        "Reports and messages reference users via user_id foreign keys. "
        "Deleting a user cascades to their reports and messages."
    )

    pdf.h1("2. Database models")

    pdf.h2("2.1 users")
    pdf.body(
        "People who send SOS reports or chat messages over the mesh. "
        "Primary key is the mesh user_id (not autoincrement). "
        "On real BLE traffic, users are created/upserted from Report and UserReply "
        "packets; origin is set from the packet's access-node ID."
    )
    pdf.h3("Fields")
    for row in [
        ("user_id", "INTEGER PK", "Unique mesh user identifier (1-65535). Comes from the phone/client packet."),
        ("name", "VARCHAR(32)", "Display name from the report packet (may be empty)."),
        ("phone", "VARCHAR(20)", "Contact phone from the report packet (may be empty)."),
        ("origin", "INTEGER NULL", "Access-node ID the phone used to enter the mesh. Set from Report/UserReply origin; required to route downlink messages via POST /api/messages/send."),
        ("first_seen", "DATETIME", "UTC timestamp when this user was first created in the portal DB."),
        ("last_seen", "DATETIME", "UTC timestamp of the most recent packet or API update for this user."),
    ]:
        pdf.field(*row)
    pdf.h3("Relationships")
    pdf.bullet("reports - one-to-many Report rows (cascade delete-orphan)")
    pdf.bullet("messages - one-to-many Message rows (cascade delete-orphan)")
    pdf.h3("API response schema (UserOut)")
    pdf.bullet("Same fields as above: user_id, name, phone, origin, first_seen, last_seen.")

    pdf.h2("2.2 reports")
    pdf.body(
        "SOS / emergency incident records. Created immediately when a report uplink "
        "is processed (or via POST /api/reports). AI fields start null and are filled "
        "later by the AI process pipeline when the LLM is configured."
    )
    pdf.h3("Fields")
    for row in [
        ("id", "INTEGER PK", "Autoincrement portal primary key."),
        ("msg_id", "INTEGER UNIQUE INDEX", "Mesh message ID used for deduplication of retransmits."),
        ("attempt", "INTEGER", "Retransmit attempt counter from the packet (informational; dedup is on msg_id)."),
        ("user_id", "INTEGER FK INDEX", "Foreign key to users.user_id - the reporter."),
        ("origin", "INTEGER", "Access-node ID the phone used to enter the mesh."),
        ("path", "JSON", "List of node IDs hop path toward the gateway, e.g. [1, 2, 9]."),
        ("category", "INTEGER", "Incident category: 0 unknown, 1 medical, 2 trapped, 3 fire, 4 flood, 5 structural, 6 security, 7 hazmat, 8 other."),
        ("people", "INTEGER", "Number of people involved (0 = unknown)."),
        ("needs", "INTEGER", "Bitflags: injured, rescue, mobility, meds, water, shelter, vulnerable."),
        ("gps_lat", "FLOAT NULL", "GPS latitude if present (often null until GPS is implemented)."),
        ("gps_lon", "FLOAT NULL", "GPS longitude if present."),
        ("gps_accuracy", "INTEGER NULL", "GPS accuracy in meters if present."),
        ("location", "VARCHAR(120)", "Human-readable location string from the reporter."),
        ("message", "VARCHAR(500)", "Free-text SOS message body from the reporter."),
        ("created_at", "DATETIME INDEX", "When the report was stored in the portal."),
        ("acked_at", "DATETIME NULL", "When an ACK was recorded/sent for this report."),
        ("status", "VARCHAR(16)", "Lifecycle status (default 'received')."),
        ("ai_priority", "INTEGER NULL", "AI-computed dispatch priority 1-5 (null until AI succeeds)."),
        ("ai_category", "INTEGER NULL", "AI-suggested category code (same enum as category); null until AI succeeds."),
        ("ai_summary", "VARCHAR(1000) NULL", "AI-written operational summary for dispatchers."),
        ("ai_responders", "JSON NULL", "Responder tags: medical_ems, fire_rescue, law_enforcement, technical_sar, humanitarian_care, coast_guard."),
    ]:
        pdf.field(*row)
    pdf.h3("Relationships / constraints")
    pdf.bullet("user - many-to-one User via user_id")
    pdf.bullet("UNIQUE (msg_id) - uq_reports_msg_id")

    pdf.h2("2.3 messages")
    pdf.body(
        "Chat / reply traffic between responders and users. Uplink UserReply packets "
        "create rows with direction='uplink'; POST /api/messages/send creates "
        "direction='downlink' rows and encodes a binary downlink Message for the gateway over BLE. "
        "HTTP paths use upstream/downstream naming; the DB direction column keeps uplink/downlink."
    )
    pdf.h3("Fields")
    for row in [
        ("id", "INTEGER PK", "Autoincrement portal primary key."),
        ("msg_id", "INTEGER NULL UNIQUE INDEX", "Mesh message ID when applicable; used for uplink dedup. Null for portal-sent downlinks from /api/messages/send."),
        ("direction", "VARCHAR(8)", "'uplink' (user to portal / UserReply) or 'downlink' (portal to user / send)."),
        ("user_id", "INTEGER FK NULL INDEX", "Foreign key to users.user_id when tied to a user; nullable."),
        ("reply_to", "INTEGER INDEX", "msg_id this message replies to (0 if none). On send, defaults to the user's latest report msg_id when omitted."),
        ("target_node", "INTEGER NULL", "For uplink: packet origin. For downlink send: users.origin (access node to route to)."),
        ("path", "JSON NULL", "Optional hop path associated with the message (set on uplink UserReply)."),
        ("sender", "VARCHAR(32)", "Sender label (empty on uplink; default 'Portal' for /api/messages/send)."),
        ("text", "VARCHAR(400)", "Message body text."),
        ("status", "VARCHAR(16)", "'received' for uplinks; 'sent' if BLE queued, 'pending' if gateway not connected (send); default 'pending' on plain POST create."),
        ("created_at", "DATETIME", "When the message row was created."),
    ]:
        pdf.field(*row)
    pdf.h3("Relationships / constraints")
    pdf.bullet("user - many-to-one User via user_id (optional)")
    pdf.bullet("UNIQUE (msg_id) - uq_messages_msg_id")
    pdf.h3("API response schema (MessageOut)")
    pdf.bullet(
        "id, msg_id, direction, user_id, reply_to, target_node, path, sender, text, status, created_at."
    )

    pdf.h2("2.4 nodes")
    pdf.body(
        "Mesh radio nodes (relay / access / gateway). Upserted from heartbeat uplinks; "
        "also manageable via /api/nodes. Stale nodes are marked offline by a background sweep."
    )
    pdf.h3("Fields")
    for row in [
        ("node_id", "INTEGER PK", "Mesh node ID (1-254). Gateway is typically 9."),
        ("role", "INTEGER", "1 = relay, 2 = access, 3 = gateway."),
        ("status", "VARCHAR(16) INDEX", "'online' or 'offline' (updated by heartbeats / offline sweep)."),
        ("clients", "INTEGER", "Number of attached clients reported by the node."),
        ("path", "JSON NULL", "Path info toward gateway as reported in heartbeat."),
        ("uptime_s", "INTEGER", "Node uptime in seconds."),
        ("tx", "INTEGER", "Transmit packet/counter statistic from heartbeat."),
        ("rx", "INTEGER", "Receive packet/counter statistic from heartbeat."),
        ("battery", "INTEGER NULL", "Battery percentage or level if reported."),
        ("neighbors", "JSON", "List of neighbor objects (e.g. id, rssi) from heartbeat."),
        ("last_seen", "DATETIME INDEX", "Last heartbeat / update time; used to mark offline."),
    ]:
        pdf.field(*row)

    pdf.add_page()
    pdf.h1("3. API routes")
    pdf.body(
        "Base app also exposes GET / (status) and GET /debug (debug HTML). "
        "Interactive OpenAPI docs are at /docs when the server is running. "
        "Debug routes are mounted when env DEBUG is not '0' (default on)."
    )

    pdf.h2("3.1 Users - /api/users")
    pdf.route("GET", "/api/users", "List all users ordered by user_id.")
    pdf.route("GET", "/api/users/{user_id}", "Get a single user. 404 if missing.")
    pdf.route(
        "POST",
        "/api/users",
        "Create a user.",
        [
            "Body: user_id (required), name?, phone?",
            "409 if user_id already exists. 201 on success.",
        ],
    )
    pdf.route(
        "PATCH",
        "/api/users/{user_id}",
        "Update name and/or phone; refreshes last_seen.",
        ["Body (optional): name, phone"],
    )
    pdf.route("DELETE", "/api/users/{user_id}", "Delete user (cascades reports/messages). 204.")

    pdf.h2("3.2 Nodes - /api/nodes")
    pdf.route("GET", "/api/nodes", "List all nodes ordered by node_id.")
    pdf.route("GET", "/api/nodes/{node_id}", "Get a single node. 404 if missing.")
    pdf.route(
        "POST",
        "/api/nodes",
        "Create a node.",
        [
            "Body: node_id (1-254), role?, status?, clients?, path?, uptime_s?, tx?, rx?, battery?, neighbors?",
            "Default path is [node_id] if omitted. 409 if exists.",
        ],
    )
    pdf.route("PATCH", "/api/nodes/{node_id}", "Partial update; refreshes last_seen.")
    pdf.route("DELETE", "/api/nodes/{node_id}", "Delete node. 204.")

    pdf.h2("3.3 Reports - /api/reports")
    pdf.route(
        "GET",
        "/api/reports",
        "List reports newest-first.",
        ["Query: user_id?, status?, limit? (1-500, default 100)"],
    )
    pdf.route(
        "GET",
        "/api/reports/{report_id}",
        "Get report by primary id, falling back to msg_id lookup.",
    )
    pdf.route(
        "POST",
        "/api/reports",
        "Create a report (also ensures user exists).",
        [
            "Body: msg_id, user_id, origin, path, category, people, needs, location, message, optional GPS and ai_* fields.",
            "409 if msg_id already exists. 201 on success.",
        ],
    )
    pdf.route("PATCH", "/api/reports/{report_id}", "Partial update by id or msg_id.")
    pdf.route("DELETE", "/api/reports/{report_id}", "Delete report by id or msg_id. 204.")

    pdf.h2("3.4 Messages - /api/messages")
    pdf.route(
        "GET",
        "/api/messages",
        "List messages newest-first.",
        ["Query: user_id?, direction?, reply_to?, limit? (1-500, default 100)"],
    )
    pdf.route(
        "GET",
        "/api/messages/upstream/{user_id}",
        "List uplink messages for a user (direction='uplink'), newest-first.",
        [
            "Path: user_id - mesh user id.",
            "Query: limit? (1-500, default 100).",
            "404 if user does not exist.",
        ],
    )
    pdf.route(
        "GET",
        "/api/messages/downstream/{user_id}",
        "List downlink messages for a user (direction='downlink'), newest-first.",
        [
            "Path: user_id - mesh user id.",
            "Query: limit? (1-500, default 100).",
            "404 if user does not exist.",
        ],
    )
    pdf.route(
        "POST",
        "/api/messages/send",
        "Send a downlink Message to a user: save DB row and queue binary packet over BLE.",
        [
            "Body: user_id (required), text (required, max 400), sender? (default 'Portal'), reply_to? (defaults to latest report msg_id or 0).",
            "target_node is taken from users.origin.",
            "Encodes packets.serial_schema.Message via encode_downlink + frame_packet, then queue_downlink.",
            "Returns MessageOut with status 'sent' if BLE queue accepted, 'pending' if gateway not connected.",
            "400 if user has no origin; 404 if user missing. 201 on success.",
        ],
    )
    pdf.route(
        "GET",
        "/api/messages/{message_id}",
        "Get by primary id, falling back to msg_id.",
    )
    pdf.route(
        "POST",
        "/api/messages",
        "Create a message row only (does not send over BLE); auto-creates empty user if user_id given and missing.",
        [
            "Body: text (required), msg_id?, direction?, user_id?, reply_to?, target_node?, path?, sender?, status?",
            "409 if msg_id already exists. Prefer POST /api/messages/send to deliver to a phone.",
        ],
    )
    pdf.route("PATCH", "/api/messages/{message_id}", "Partial update by id or msg_id.")
    pdf.route("DELETE", "/api/messages/{message_id}", "Delete by id or msg_id. 204.")

    pdf.h2("3.5 Stats & health - /api")
    pdf.route(
        "GET",
        "/api/stats",
        "Aggregate counts: users, reports, nodes_total/online/offline, messages, latest_report_at.",
    )
    pdf.route("GET", "/api/health", 'Liveness check. Returns {"status": "online"}.')

    pdf.h2("3.6 AI - /api/ai")
    pdf.route(
        "POST",
        "/api/ai/process",
        "Run AI process on report/packet JSON (LLM currently stubbed).",
        [
            "Body: category?, people?, needs?, location?, message?, gps_*, msg_id?, prompt_name?, include_prompt?, persist?",
            "Returns: ai_summary, ai_priority, ai_category, ai_responders, status (stub|ok|parse_error), prompt_name, prompt?",
            "persist=true requires msg_id and only writes DB when status is ok.",
        ],
    )
    pdf.route("GET", "/api/ai/prompts", "List prompt names stored as *.md under backend/prompts/.")
    pdf.route("GET", "/api/ai/prompts/{name}", "Load prompt markdown content.")
    pdf.route(
        "PUT",
        "/api/ai/prompts/{name}",
        "Create/overwrite a prompt file.",
        ['Body: { "content": "...markdown with {{placeholders}}..." }'],
    )

    pdf.h2("3.7 Debug - /api/debug (DEBUG enabled)")
    pdf.route("GET", "/api/debug/export", "Export all users, reports, nodes, messages as JSON.")
    pdf.route(
        "POST",
        "/api/debug/import",
        "Import JSON.",
        ["Body: users/reports/nodes/messages arrays and mode=merge|replace."],
    )
    pdf.route("POST", "/api/debug/reset", "DANGER: truncate all tables.")
    pdf.route("POST", "/api/debug/fake/heartbeat", "Inject a synthetic heartbeat through packet_handler.")
    pdf.route(
        "POST",
        "/api/debug/fake/report",
        "Inject a synthetic report uplink (stores report; enqueues AI process).",
    )
    pdf.route("POST", "/api/debug/fake/user_reply", "Inject a synthetic user_reply uplink.")
    pdf.route("POST", "/api/debug/seed_random", "Insert random demo users/nodes/reports/messages.")

    pdf.h2("4. Notes")
    pdf.bullet("Default DB URL: sqlite:///./portal.db (override with DATABASE_URL).")
    pdf.bullet("Schema migrations live under alembic/versions/; models also drive create_all on startup.")
    pdf.bullet(
        "Migration c3d4e5f6a7b8 adds users.origin (nullable INTEGER). "
        "Run alembic upgrade head on existing DBs."
    )
    pdf.bullet(
        "Packet wire format still includes severity for protocol compatibility, "
        "but reports no longer store severity; priority is ai_priority only."
    )
    pdf.bullet(
        "AI responder values: medical_ems, fire_rescue, law_enforcement, "
        "technical_sar, humanitarian_care, coast_guard."
    )
    pdf.bullet(
        "Chat path: UserReply uplink -> messages(direction=uplink) + Ack; "
        "POST /api/messages/send -> messages(direction=downlink) + BLE binary Message. "
        "List with GET /api/messages/upstream|downstream/{user_id}."
    )
    pdf.bullet("Live OpenAPI: http://localhost:<port>/docs")

    pdf.output(str(OUT))
    return OUT


if __name__ == "__main__":
    path = build()
    print(f"Wrote {path} ({path.stat().st_size} bytes)")
