import { configureMainnet, near } from "@/lib/near";

// This is a Server Component — near.view() runs at request time on the server.
// View source in your browser to confirm the data is in the HTML (no client JS needed).

export default async function ViewOnlyPage() {
  configureMainnet();

  const meta = await near.view({
    contractId: "wrap.near",
    methodName: "ft_metadata",
  });

  return (
    <div className="container">
      <h1>View Only</h1>
      <p className="subtitle">
        Server-side <code>near.view()</code> — this data was fetched on the
        server at request time
      </p>

      <section>
        <h2>wNEAR Token Metadata</h2>
        <table className="metadata-table">
          <tbody>
            <tr>
              <td>Name</td>
              <td>{meta.name}</td>
            </tr>
            <tr>
              <td>Symbol</td>
              <td>{meta.symbol}</td>
            </tr>
            <tr>
              <td>Decimals</td>
              <td>{meta.decimals}</td>
            </tr>
            <tr>
              <td>Icon</td>
              <td>
                {meta.icon && (
                  <img
                    src={meta.icon}
                    alt={meta.name}
                    width={48}
                    height={48}
                    style={{ borderRadius: 8 }}
                  />
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2>Raw JSON</h2>
        <pre>{JSON.stringify(meta, null, 2)}</pre>
      </section>
    </div>
  );
}
