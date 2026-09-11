# B CONNECT training guides

- `/guide/retailer` is public, including new and unregistered visitors. It covers registration, ordering, proforma confirmation, repeat orders, offers, wishlist, returns, tracking and support.
- `/guide` is the staff library/share desk. No training item is added to the main operational sidebar. `Share training` appears inside the profile menu only for Sales, Admin and configured WhatsApp administrators.
- Staff routes: `warehouse-manager`, `purchaser`, `sales`, `accounts`, `delivery-manager`, `delivery`, `delivery-collection`, `collection`, `analyst`, `admin`.
- Aliases: `sell`, `salesman`, `warehouse`, `purchase`, `delivery+collection`, `collection-agent`, `data-analyst`.
- The API reads the active user's current roles from the session. A combined Delivery + Collection guide requires both a delivery role and Collection Agent. Main Admin and the existing configured WhatsApp admin identities can read all guides.
- Sales shares the public retailer URL with anyone; mapped retailers are an optional recipient picker. Both admins can select active staff and share that staff member's assigned guide links. Share actions open the user's share sheet or WhatsApp composer; no message is sent automatically.
- Each chapter attempts Hindi narration automatically. Browsers that block initial autoplay show a tap-to-start button. Completion shows replay; changing chapter, leaving the page or hiding the tab cancels the previous narration. The Hindi transcript remains available when speech is unsupported.
- The final CTA opens the business WhatsApp number configured through `WHATSAPP_DISPLAY_PHONE` / `WHATSAPP_BUSINESS_PHONE`, or WhatsApp's entry page if no number is configured.
- Content comes from `/guides/:slug` after server authorization (retailer excepted); protected lesson content is not shipped in the frontend bundle. Guide/API responses are not cached by the service worker. All guides are noindex and outside normal navigation.
- Activities use sample data and do not create operational orders, payments or messages.

Validation: `npm test`, `npm run build`, and `apps/api/test/guides.test.ts` cover the role/route matrix, public retailer, both admins, stale sessions and salesperson recipient scope. Browser checks cover mobile layout, search practice, audio start/end/replay, chapter switching, denied role and staff login.
