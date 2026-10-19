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
   **₹ per ₹100** (filled in from the owner's slabs in Settings → Configuration as the loan amount
   is typed), then click **Register & print bill**.
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

**Scanning a bill QR code**

- Hold the QR code inside the square, about 10–15 cm away. It is captured automatically:
  the frame turns green with **✓ QR found** and the registration opens. No button press is needed.
- Every camera frame is tried with different zoom levels and clean-up filters (glare and
  light-reflection removal, uneven-light correction, contrast boost, sharpening, mirrored
  images), so most glare is corrected automatically. If a reflection completely hides part
  of the code, tilt the bill slightly.
- **Capture now** takes a full-resolution still and searches it thoroughly (progress is shown).
- **Upload photo** reads a photo from the gallery or a file with the same thorough search:
  the whole photo, the centre and overlapping tiles at several sizes, each with the glare
  and lighting filters, then mirrored. The QR code does not need to fill the picture.
- A QR code that is not a shop bill (for example a UPI code) is ignored, with a message.
- Without the live camera (plain `http://`), **Take photo** opens the phone camera app.
- Phones with a built-in QR detector (Android Chrome, Safari) use it as well. If several
  cameras exist, pick one in the scanner; phones with a flash get a **Light on** button.
- Bills print the QR code at 20 mm with high error correction (about 25% of the code can be
  damaged or hidden by glare and it still reads). Reprint older bills for best results.
- If a bill is torn or badly creased, type the token printed under the QR code, or search by
  mobile number or name.

## Interest rules

- Interest can be entered as a percentage or in rupees. A rupee rate is counted **for every
  ₹100 of loan** unless the owner changes it: ₹2 per ₹100 a month on ₹50,000 is ₹1,000 a month
  (the same as 2%). Paise are allowed in this rate, e.g. ₹1.50 per ₹100.
- Everything about interest is set by the owner in **Settings → Configuration**:
  - **How interest in ₹ is counted**: for every ₹100, ₹1,000 or any amount, or a fixed ₹ amount
    on the whole loan (whole rupees only).
  - **Interest by loan amount** (slabs), e.g. up to ₹50,000 → ₹2 per ₹100, up to ₹2,00,000 →
    ₹1.50 per ₹100. New Registration fills in the interest from the slab the loan amount fits
    in; the owner can still type a different rate for any customer.
  - **Default interest** for loans above the slabs (% or ₹, per month or year, simple or compound).
  - **Part-month interest** rule, and the **shop name** shown on bills and screens.
- The Backup and Password tabs are in the same Settings window.
- Interest is always charged in whole rupees (nearest rupee), so every amount due can be
  paid without paise. Loan amounts and payments must be whole rupees.
- Interest accrues only on the loan amount still outstanding; payments clear interest first.
- Once fully paid, no further interest is added. Closed registrations are frozen at the release date.
- Settings apply to new registrations only; each registration keeps the rate and rules it was
  created with (older ₹ registrations stay as a fixed amount on the whole loan).

## Data and backups

- Database and photos: `data/` (or `DATA_DIR`). Backups: `backups/` (or `BACKUP_DIR`).
- A backup is taken at startup and at most every 5 minutes after changes; the last 30 are kept.
- Copy `data/photos` and `backups/` to external storage regularly.

See `.env.example` for ports, data folders and other settings.
