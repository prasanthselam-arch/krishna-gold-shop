# krishna-gold-shop

Gold loan (pledge) desk for Krishna Gold Shop: register pledges with customer and jewellery
photos, print ID-card size bills with a barcode, take payments, and return gold after OTP check.

## Setup on a new computer

```bash
./run.sh check          # what is missing (system tools from requirements.txt + npm packages)
./run.sh setup          # install everything missing (--dry-run to preview)
```

`./run.sh start` also does this automatically. Node.js is installed with nvm (no sudo);
other tools use the system package manager (apt, dnf, yum, pacman, zypper or brew) and may
ask for your password. JavaScript packages are reinstalled automatically when
`package-lock.json` or the Node.js version changes.

## Run

The server runs in the background, so the terminal stays free.

```bash
./run.sh start        # production, open http://localhost:8787
./run.sh start dev    # development with auto-reload, open http://localhost:5173
./run.sh stop
./run.sh restart
./run.sh status
./run.sh logs         # last 100 lines; "logs -f" to follow
./run.sh build        # rebuild the web app (then restart)
./run.sh backup       # database backup now
```

Logs are written to `logs/server.log`.

First sign-in: `owner` / `KrishnaGold@123`. You will be asked to set a new password.

## Daily use

1. **New pledge**: fill customer details, take the customer photo, add gold items, take the
   jewellery photo, enter loan amount and rate, then click **Save pledge & print bill**.
   Two ID-card size bills are printed: *Customer copy* and *Shop copy*.
2. **Find / Pay / Return**: scan the barcode on the customer's bill (USB scanner or
   **Scan with camera**), or type the token, name or mobile number.
   - **Receive payment**: interest is cleared first, the rest reduces the loan.
   - **Return gold**: only when nothing is due. Take photos of the person and the jewellery,
     send the OTP, enter it, and the release bill is printed.
3. **Records**: totals and the list of all pledges.
4. **Interest calculator** (top bar) opens as a popup. From a pledge it opens pre-filled.

## Printing bills

The bill preview offers two paper options:

- **A4 sheet (cut out)**: both cards on one A4 page with cut lines.
- **ID card printer**: page size 85.6 × 54 mm, one card per page.

In the browser print dialog set *Margins: None* and enable *Background graphics*.

## Camera

The camera works on `http://localhost` or over `https://`. When opened from another computer
or phone on the shop network over plain `http://`, browsers block the camera; the
**Upload** button still opens the phone camera, and a USB barcode scanner always works.

## Interest rules

- Interest accrues only on the loan amount still outstanding; payments clear interest first.
- Once fully paid, no further interest is added. Closed pledges are frozen at the release date.
- The part-month rule (Settings) applies to new pledges; each pledge keeps the rule it was created with.

## Data and backups

- Database and photos: `data/` (or `DATA_DIR`). Backups: `backups/` (or `BACKUP_DIR`).
- A backup is taken at startup and at most every 5 minutes after changes; the last 30 are kept.
- Copy `data/photos` and `backups/` to external storage regularly.

See `.env.example` for SMS / email OTP and other settings.
