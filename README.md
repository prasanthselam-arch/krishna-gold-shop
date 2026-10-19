# krishna-gold-shop

Gold loan desk for Krishna Gold Shop: register customers with customer and jewellery photos,
print ID-card size bills with a QR code, take payments, and return gold.

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
./run.sh status       # also shows the https:// address for phones and tablets
./run.sh logs         # last 100 lines; "logs -f" to follow
./run.sh build        # rebuild the web app (then restart)
./run.sh backup       # database backup now
```

Logs are written to `logs/server.log`.

First sign-in: `owner` / `KrishnaGold@123`. You will be asked to set a new password.
Forgot it? Run `./run.sh reset-password`.

## Daily use

1. **New Registration**: fill customer details, take the customer photo, add gold items, take
   the jewellery photo, enter the loan amount and the interest per month, either in **%** or in
   **₹**, then click **Register & print bill**.
   Two ID-card size bills are printed: *Customer copy* and *Shop copy*.
2. **Find / Pay / Return**: scan the QR code on the customer's bill (**Scan QR** uses the
   camera), or type the token, name or mobile number.
   - **Receive payment**: interest is cleared first, the rest reduces the loan. Amounts are
     whole rupees only. Optionally change the extra days of interest to round off
     (e.g. 2 months + 16 days → 15 days, or 30 for a full month).
   - **Give more money**: the customer takes more cash on the same items. Today's balance
     (loan left + interest) plus the extra cash becomes a new loan with a new bill; you can
     set the new date, interest (% or ₹), interest type and part-month rule. The old loan
     is marked *Renewed* and links to the new one.
   - **Return gold**: only when nothing is due. Enter the name of the person collecting
     (pre-filled with the customer), take photos of the person and the jewellery, tick the
     confirmation and click **Confirm & return gold**.
   - **Print bill** reprints the ID-card bills at any time.
3. **Records**: totals, **Collections between dates** (cash collected, interest, loan repaid,
   cash given out, gold returned, and the payment list for any date range), and the list of
   all registrations.
4. **Calculator** (top bar) opens as a popup. From a registration it opens pre-filled.

The app adapts to phones (portrait and landscape), tablets and large screens. On phones the
tabs move to the bottom of the screen and popups open full screen.

## Printing bills

The bill shows only: customer name, mobile number, items with quantity and weight, pledge
date, loan amount, customer photo, jewellery photo and the QR code.

The bill preview offers two paper options:

- **A4 sheet**: both cards on one A4 page with cut lines.
- **ID card printer**: page size 85.6 × 54 mm, one card per page.

The app sets the page margin to zero, so the browser does not print its header or footer
(date, title, URL, page number). If they still appear, open *More settings* in the print
dialog, untick *Headers and footers* and set *Margins: None*. Turn on *Background graphics*.

## Camera (phones and tablets)

Browsers only allow the camera on `http://localhost` or on `https://`. On first start,
`run.sh` creates a self-signed certificate and the server also listens on
`https://<this-computer-ip>:8443` (see `./run.sh status`). Open that address on the phone,
accept the "not secure / advanced → proceed" warning once, and the camera works for photos
and QR scanning. When the scanner is opened over plain `http://` it shows an
**Open secure page** button that goes to the right address.

Without the live camera, **Take photo** (phone camera app) or **Upload photo** (gallery or
file) still work: the photo is searched at several sizes and positions, so the QR code
does not need to fill the picture. Phones with a built-in QR detector (Android Chrome,
Safari) use it automatically. If several cameras exist, pick one in the scanner; phones
with a flash get a **Light on** button.

## Interest rules

- Interest per month can be a percentage or a fixed rupee amount. A rupee amount is turned
  into the equivalent percentage of the loan amount, so the first month costs exactly that amount.
- Interest is always charged in whole rupees (nearest rupee), so every amount due can be
  paid without paise. Loan amounts and payments must be whole rupees.
- Interest accrues only on the loan amount still outstanding; payments clear interest first.
- Once fully paid, no further interest is added. Closed registrations are frozen at the release date.
- The part-month rule (Settings) applies to new registrations; each one keeps the rule it was
  created with.

## Data and backups

- Database and photos: `data/` (or `DATA_DIR`). Backups: `backups/` (or `BACKUP_DIR`).
- A backup is taken at startup and at most every 5 minutes after changes; the last 30 are kept.
- Copy `data/photos` and `backups/` to external storage regularly.

See `.env.example` for ports, data folders and other settings.
