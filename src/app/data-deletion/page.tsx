export const metadata = {
  title: 'Exclusão de Dados — Brand',
  description: 'Solicitação de exclusão de dados do aplicativo IA News BR API.',
}

export default async function DataDeletionPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>
}) {
  const { code } = await searchParams

  return (
    <main style={{
      maxWidth: 680,
      margin: '0 auto',
      padding: '60px 24px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      color: '#1a1a1a',
      lineHeight: 1.7,
    }}>
      <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 8 }}>Exclusão de Dados</h1>

      {code ? (
        <>
          <div style={{
            background: '#f0fdf4',
            border: '1px solid #bbf7d0',
            borderRadius: 8,
            padding: '20px 24px',
            marginBottom: 32,
          }}>
            <p style={{ margin: 0, fontWeight: 600, color: '#16a34a', fontSize: 18 }}>
              ✅ Solicitação registrada
            </p>
            <p style={{ margin: '8px 0 0', color: '#15803d', fontSize: 14 }}>
              Código de confirmação: <code style={{ fontFamily: 'monospace', background: '#dcfce7', padding: '2px 6px', borderRadius: 4 }}>{code}</code>
            </p>
          </div>
          <p>
            Sua solicitação de exclusão de dados foi recebida. O aplicativo <strong>IA News BR API</strong> não
            armazena dados pessoais de usuários finais — apenas tokens de acesso da conta de negócios
            da Brand, que são de responsabilidade do administrador da conta.
          </p>
          <p>
            Caso queira revogar o acesso do aplicativo diretamente, acesse as configurações
            de privacidade do Facebook ou Instagram e remova as permissões concedidas ao app.
          </p>
        </>
      ) : (
        <>
          <p style={{ color: '#666', marginBottom: 32 }}>
            Informações sobre exclusão de dados do aplicativo IA News BR API, operado pela Brand.
          </p>

          <section style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>Quais dados o app armazena?</h2>
            <p>
              O aplicativo armazena exclusivamente tokens de acesso OAuth da conta de negócios
              da Brand no Instagram/Facebook. <strong>Não são armazenados dados pessoais
              de usuários externos</strong>.
            </p>
          </section>

          <section style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>Como revogar acesso</h2>
            <p>Para remover o acesso do aplicativo à sua conta do Facebook/Instagram:</p>
            <ol style={{ paddingLeft: 24, marginTop: 8 }}>
              <li>Acesse <strong>Configurações → Segurança e login → Aplicativos e sites</strong> no Facebook</li>
              <li>Localize <strong>IA News BR API</strong></li>
              <li>Clique em <strong>Remover</strong></li>
            </ol>
          </section>

          <section style={{ marginBottom: 48 }}>
            <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>Contato</h2>
            <p>
              Para solicitar exclusão manual de dados ou esclarecimentos:
              <br />
              <a href="mailto:contato@your-company.example" style={{ color: '#8B35FF' }}>
                contato@your-company.example
              </a>
            </p>
          </section>
        </>
      )}

      <hr style={{ borderColor: '#eee', marginBottom: 24 }} />
      <p style={{ color: '#999', fontSize: 14 }}>
        © {new Date().getFullYear()} Brand Eletromobilidade.{' '}
        <a href="/privacy" style={{ color: '#8B35FF' }}>Política de Privacidade</a>
      </p>
    </main>
  )
}
