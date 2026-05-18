# OpenStock Compliance Notes

This project is licensed under the GNU Affero General Public License v3.0
(AGPL-3.0). These notes are operational guidance for this private deployment
copy; they do not replace the LICENSE file.

## Private Repository Use

Keeping this repository private is acceptable for local evaluation, private
development, or internal use where the service is not offered to outside users.

If you deploy a modified version as a public web service, AGPL-3.0 requires
that users of that service can access the Corresponding Source for the version
running on the server, under AGPL-3.0. In practice, do one of the following
before public launch:

- Make the deployment source repository public under AGPL-3.0.
- Publish a complete source archive for the deployed version.
- Give every network user access to the private repository containing the
  deployed source.

## Attribution

Do not remove:

- `LICENSE`
- README license and attribution sections
- Open Dev Society attribution
- Contributor acknowledgements
- Third-party notices in dependency packages

The app footer includes a Source Code link. For a public deployment of this
modified copy, set:

```env
NEXT_PUBLIC_SOURCE_CODE_URL=https://github.com/<owner>/<public-agpl-source-repo>
```

If the repository remains private, the service should remain private/internal
unless each user has source access through another compliant route.

## Data and API Terms

Market data, charts, email, and AI integrations have their own provider terms.
Before public use, confirm your configured accounts permit the intended usage:

- Finnhub API
- TradingView widgets
- Gmail or SMTP provider
- Inngest
- Gemini, MiniMax, Siray, or Adanos if enabled

Do not commit API keys, credentials, or `.env` files.
