import type { Metadata } from "next";
import { LegalEntity, LegalPage, List, Section } from "@/components/legal/legal-page";
import { LEGAL_UPDATED_AT } from "@/components/legal/legal-config";

// O endereço absoluto (canonical) usa o metadataBase do layout: NEXT_PUBLIC_SITE_URL, o domínio de produção da Vercel ou o endereço local de desenvolvimento.
export const metadata: Metadata = {
  alternates: { canonical: "/privacidade" },
  title: "Política de Privacidade | Harmonize+",
  description: "Como o Harmonize+ coleta, usa, protege e compartilha dados, incluindo o uso de dados do Google Agenda.",
};

const linkClass = "font-semibold text-[#5147dc] underline underline-offset-2";

export default function PrivacyPage() {
  return (
    <LegalPage current="privacidade" title="Política de Privacidade" updatedAt={LEGAL_UPDATED_AT}>
      <p>O Harmonize+ é um sistema de gestão para clínicas de estética e harmonização (agenda, cadastro de clientes, registros clínicos, orçamentos e financeiro). Esta política explica quais dados tratamos, para quê, com quem os compartilhamos e como os protegemos, em conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018, LGPD).</p>

      <Section id="papeis" title="1. Quem é responsável pelos dados">
        <p>Há dois grupos de dados, com papéis diferentes:</p>
        <List>
          <li><strong>Dados da conta e da segurança de quem usa o sistema</strong> (administradores, profissionais e atendentes): o Harmonize+ é o controlador.</li>
          <li><strong>Dados de clientes/pacientes da clínica</strong> (cadastro, avaliações, fotos, documentos, agenda, orçamentos): a clínica é a controladora, pois decide quais dados coletar e por quê. O Harmonize+ os trata em nome da clínica, como operador, para fornecer o sistema.</li>
        </List>
        <p>Se você é paciente de uma clínica, dirija primeiro à própria clínica os pedidos sobre os seus dados. Também podemos ajudar pelo contato indicado na seção 11.</p>
      </Section>

      <Section id="dados" title="2. Dados que tratamos">
        <p><strong>Conta de quem usa o sistema:</strong> nome, e-mail, senha (guardada apenas como hash), telefone, CPF, endereço, profissão, área de atuação, foto de perfil, função na clínica e, quando a clínica informa, o custo/hora do colaborador. Se você entra com o Google, guardamos o identificador da conta Google, o e-mail e a data do último acesso.</p>
        <p><strong>Dados da clínica:</strong> nome, CNPJ, telefone, e-mail, endereço, horários, preferências e custos operacionais.</p>
        <p><strong>Dados de clientes/pacientes, inseridos pela clínica:</strong></p>
        <List>
          <li>identificação e contato: nome, nome social, CPF, telefone, e-mail, data de nascimento, sexo, profissão e endereço;</li>
          <li>contato de emergência e, para menores, dados do responsável legal;</li>
          <li>convênio, quando houver;</li>
          <li><strong>dados de saúde (sensíveis)</strong>: alergias, medicamentos em uso, observações de saúde, anamnese, avaliações, histórico de procedimentos, fotos clínicas e documentos e termos de consentimento anexados;</li>
          <li>agenda, orçamentos e pagamentos registrados pela clínica;</li>
          <li>a preferência do cliente de receber lembretes por WhatsApp (o sistema apenas registra essa preferência e não envia mensagens por WhatsApp);</li>
          <li>o registro de que a política de privacidade foi apresentada ao cliente, com data e versão.</li>
        </List>
        <p><strong>Dados técnicos e de segurança:</strong> endereço IP, navegador/dispositivo (user agent), data e tipo de eventos de segurança (entradas, falhas de login, ativação da verificação em duas etapas, troca de senha, sessões encerradas), um breve detalhe do evento (por exemplo, a origem do acesso, como o aplicativo móvel) e o nome dos dispositivos marcados como confiáveis.</p>
      </Section>

      <Section id="finalidades" title="3. Para que usamos os dados">
        <List>
          <li>Criar e manter a conta, autenticar o acesso e proteger contas (senha, verificação em duas etapas, sessões e dispositivos).</li>
          <li>Prestar o serviço contratado: agenda, prontuário e registros clínicos, orçamentos, financeiro e estoque da clínica.</li>
          <li>Enviar e-mails do sistema: código de verificação do cadastro, convites de equipe, avisos de agendamento ao profissional e, quando a clínica mantém essa opção ligada e o paciente tem e-mail cadastrado, confirmação, reagendamento e cancelamento de consulta e envio de orçamento (com PDF) ao paciente.</li>
          <li>Integrar o Google Agenda, quando você ou sua clínica optam por conectá-lo (seção 5).</li>
          <li>Prevenir fraude e uso indevido e cumprir obrigações legais.</li>
        </List>
        <p>As bases legais incluem a execução do contrato com a clínica, o cumprimento de obrigações legais, o legítimo interesse na segurança do serviço e, quando aplicável, o consentimento. Os dados de saúde dos pacientes são tratados pela clínica para a tutela da saúde, em procedimentos realizados por profissionais de saúde, conforme o art. 11 da LGPD.</p>
      </Section>

      <Section id="google" title="4. Login com Google">
        <p>Ao entrar ou criar conta com o Google, pedimos apenas os escopos <em>openid</em>, <em>e-mail</em> e <em>perfil</em>. Usamos o identificador da conta, o e-mail verificado e o nome para localizar ou criar a sua conta. Não guardamos tokens de acesso desse login e não lemos outros dados da sua conta Google.</p>
      </Section>

      <Section id="agenda" title="5. Integração com o Google Agenda">
        <p>A integração é opcional e só é ativada quando um administrador conecta a agenda central da clínica ou um profissional conecta a própria agenda. Pedimos o escopo <code className="rounded bg-[#f1f3fb] px-1 text-[13px]">https://www.googleapis.com/auth/calendar.events</code>, que permite criar, editar e cancelar eventos. Usamos esse acesso somente para refletir na sua Agenda Google os atendimentos marcados no Harmonize+.</p>
        <p><strong>O que é enviado ao Google em cada evento:</strong> título (“Atendimento – procedimento”), nome do paciente, procedimento, horário e duração, nome do profissional, um link para a agenda no Harmonize+ e identificadores internos do agendamento e da clínica (propriedades privadas do evento). Não enviamos notas clínicas, diagnósticos, fotos, telefone nem CPF. O e-mail do paciente não é usado como convidado do evento; o convidado é o e-mail do profissional responsável, e o Google envia a ele o convite por e-mail.</p>
        <p><strong>O que guardamos:</strong> o e-mail e o identificador da conta Google conectada, o calendário usado, a validade e o escopo concedido, e os tokens de acesso e de renovação, <strong>criptografados</strong> (AES-256-GCM) e nunca enviados ao navegador. Guardamos também o identificador de cada evento criado, para atualizá-lo ou cancelá-lo sem duplicar.</p>
        <p><strong>Como desconectar:</strong> na tela de integrações do Harmonize+ (Configurações, para a agenda central; “Minha agenda Google”, para a conexão individual). Ao desconectar, apagamos os tokens guardados e revogamos o acesso junto ao Google. Se a revogação falhar, a conexão é desativada localmente mesmo assim; e se a mesma conta Google ainda estiver em outra conexão ativa do Harmonize+ (por exemplo, agenda central e individual), o acesso no Google é mantido para essa outra conexão até que ela também seja desconectada. Os eventos já criados permanecem na sua Agenda Google, e você pode removê-los por lá. Você também pode revogar o acesso a qualquer momento em <a className={linkClass} href="https://myaccount.google.com/permissions" rel="noopener noreferrer" target="_blank">myaccount.google.com/permissions</a>.</p>
        <p><strong>Uso limitado (Limited Use):</strong> o uso e a transferência, para qualquer outro app, das informações recebidas das APIs do Google pelo Harmonize+ seguem a <a className={linkClass} href="https://developers.google.com/terms/api-services-user-data-policy" rel="noopener noreferrer" target="_blank">Política de Dados do Usuário dos Serviços de API do Google</a>, incluindo os requisitos de Uso Limitado. Em particular: usamos os dados do Google Agenda apenas para fornecer a funcionalidade descrita acima; não os transferimos a terceiros, exceto quando necessário para prestar o serviço, cumprir a lei ou com o seu consentimento; não os usamos para publicidade nem para treinar modelos de inteligência artificial; e nenhuma pessoa os lê, exceto com o seu consentimento, por segurança, por obrigação legal ou em dados agregados e anonimizados.</p>
      </Section>

      <Section id="compartilhamento" title="6. Com quem compartilhamos">
        <p>Não vendemos dados. Compartilhamos apenas com os prestadores necessários ao funcionamento do serviço:</p>
        <List>
          <li><strong>Vercel</strong>: hospedagem da aplicação e execução de tarefas agendadas.</li>
          <li><strong>Supabase</strong>: hospedagem do banco de dados PostgreSQL, onde ficam também as fotos e os documentos clínicos. O sistema prevê a possibilidade de guardá-los em armazenamento privado do mesmo provedor, com o mesmo controle de acesso.</li>
          <li><strong>Resend</strong>: envio dos e-mails do sistema (o conteúdo inclui, conforme a mensagem, nome, horário, procedimento e, no orçamento, valores e PDF).</li>
          <li><strong>Google</strong>: login com Google e Google Agenda, quando você os utiliza.</li>
          <li><strong>ViaCEP</strong>: ao preencher o CEP nos cadastros (perfil, colaboradores, convites e clientes/pacientes), o navegador de quem está preenchendo consulta o serviço, que recebe o número do CEP e o endereço IP dessa pessoa. Os demais dados do cadastro não são enviados.</li>
        </List>
        <p>Dentro da clínica, o acesso aos dados segue a função de cada pessoa (administrador, profissional, atendente): os dados clínicos, por exemplo, não ficam disponíveis para atendentes. Cada clínica enxerga apenas os seus próprios dados. Esses prestadores podem processar dados em servidores fora do Brasil; nesses casos, a transferência observa a LGPD.</p>
        <p>Não usamos ferramentas de análise de audiência, pixels de publicidade nem cookies de terceiros.</p>
      </Section>

      <Section id="seguranca" title="7. Como protegemos">
        <List>
          <li>Senhas guardadas somente como hash (bcrypt), com regra de senha forte no cadastro e na troca.</li>
          <li>Sessão por cookie com <em>HttpOnly</em> e <em>SameSite</em> (e <em>Secure</em> em produção), que pode ser encerrada pelo usuário; a troca de senha desconecta os outros dispositivos.</li>
          <li>Verificação em duas etapas (aplicativo autenticador), com códigos de recuperação guardados como hash; é obrigatória para administradores. Dispositivos confiáveis valem por 30 dias e podem ser removidos.</li>
          <li>Bloqueio temporário após tentativas repetidas de login e de código.</li>
          <li>Tokens do Google Agenda criptografados no banco de dados (AES-256-GCM).</li>
          <li>Separação dos dados por clínica e controle de acesso por função.</li>
          <li>Acesso às fotos e documentos clínicos somente por rotas autenticadas, com registro dos acessos a arquivos clínicos.</li>
        </List>
        <p>Nenhum sistema é totalmente imune a falhas. Se ocorrer um incidente que possa gerar risco ou dano relevante, comunicaremos os envolvidos e a autoridade competente nos termos da LGPD.</p>
      </Section>

      <Section id="cookies" title="8. Cookies e armazenamento no navegador">
        <p>Usamos somente cookies necessários ao funcionamento e à segurança, todos <em>HttpOnly</em>:</p>
        <List>
          <li><strong>harmonize_session</strong>: mantém você conectado (até 7 dias).</li>
          <li><strong>harmonize_mfa</strong>: etapa pendente da verificação em duas etapas (10 minutos).</li>
          <li><strong>harmonize_td</strong>: lembra o dispositivo confiável (30 dias).</li>
          <li><strong>harmonize_oauth</strong>, <strong>harmonize_google_pending</strong>, <strong>harmonize_google_signup</strong> e <strong>harmonize_gcal_oauth</strong>: controlam as etapas de login/cadastro com Google e de conexão do Google Agenda (10 minutos).</li>
        </List>
        <p>No aplicativo móvel do Harmonize+, a sessão usa um token de acesso válido por 3 dias, em vez de cookie, e fica revogável nas configurações de segurança.</p>
        <p>No armazenamento local do navegador guardamos apenas preferências de interface (tema claro/escuro e se o tour de boas-vindas já foi visto) e marcadores técnicos de sessão, como o aviso para sincronizar abas ao entrar ou sair. Dados de pacientes não são guardados no navegador.</p>
      </Section>

      <Section id="retencao" title="9. Por quanto tempo guardamos">
        <p>Mantemos os dados enquanto a conta e a clínica estiverem ativas e pelo tempo necessário para cumprir obrigações legais e regulatórias, incluindo a guarda de prontuários. Hoje apenas alguns dados técnicos são apagados automaticamente: sessões expiradas ou revogadas, tarefas concluídas de sincronização com o Google Agenda (após 7 dias) e cadastros pendentes não concluídos. Não há prazo automático definido para os demais dados, como o histórico de segurança; eles são mantidos enquanto necessários e podem ser removidos ou anonimizados mediante solicitação cabível. Quando um colaborador é removido e não pertence a outra clínica, a conta dele e os dados de acesso associados são excluídos.</p>
        <p>Os prazos de guarda de prontuários e demais registros clínicos previstos em lei e nas normas dos conselhos profissionais são de responsabilidade da clínica. O Harmonize+ não define nem aplica esses prazos aos dados que a clínica registra.</p>
      </Section>

      <Section id="direitos" title="10. Seus direitos">
        <p>Nos termos da LGPD, você pode pedir confirmação de que tratamos seus dados, acesso, correção, anonimização, bloqueio ou eliminação de dados desnecessários, portabilidade, informação sobre compartilhamento e a revogação do consentimento quando o tratamento se basear nele. Alguns dados precisam ser mantidos por obrigação legal.</p>
        <p>Hoje o sistema ainda não oferece, por conta própria, telas de exclusão de conta, de exportação de dados ou de anonimização. Esses pedidos são tratados pela nossa equipe a partir do contato da seção 11, com verificação da identidade de quem pede. No caso de dados de pacientes, quem decide sobre o pedido é a clínica, e nós a apoiamos no atendimento. Você também pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).</p>
      </Section>

      <Section id="contato" title="11. Identificação do responsável e contato">
        <p>Use este contato para dúvidas, pedidos de titulares e comunicação de incidentes.</p>
        <LegalEntity />
      </Section>

      <Section id="alteracoes" title="12. Alterações desta política">
        <p>Podemos atualizar esta política. A data de atualização fica no topo da página e, em mudanças relevantes, avisaremos pelo sistema ou por e-mail.</p>
      </Section>
    </LegalPage>
  );
}
