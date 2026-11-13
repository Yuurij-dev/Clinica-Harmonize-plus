import type { Metadata } from "next";
import Link from "next/link";
import { LegalEntity, LegalPage, List, Section } from "@/components/legal/legal-page";
import { LEGAL_UPDATED_AT } from "@/components/legal/legal-config";
import { TRIAL_DAYS } from "@/lib/clinic-signup-rules";

// O endereço absoluto (canonical) usa o metadataBase do layout: NEXT_PUBLIC_SITE_URL, o domínio de produção da Vercel ou o endereço local de desenvolvimento.
export const metadata: Metadata = {
  alternates: { canonical: "/termos" },
  title: "Termos de Uso | Harmonize+",
  description: "Condições de uso do Harmonize+, sistema de gestão para clínicas de estética e harmonização.",
};

const linkClass = "font-semibold text-[#5147dc] underline underline-offset-2";

export default function TermsPage() {
  return (
    <LegalPage current="termos" title="Termos de Uso" updatedAt={LEGAL_UPDATED_AT}>
      <p>Estes Termos regulam o uso do Harmonize+, sistema de gestão para clínicas de estética e harmonização. Ao criar uma conta ou usar o sistema, você declara que leu e concorda com eles e com a <Link className={linkClass} href="/privacidade">Política de Privacidade</Link>.</p>

      <Section id="servico" title="1. O serviço">
        <p>O Harmonize+ oferece, pela internet, ferramentas para a clínica organizar agenda, cadastro de clientes, registros clínicos (avaliações, fotos, documentos e termos), orçamentos, financeiro, estoque e equipe, além de integrações opcionais, como o Google Agenda. As funcionalidades podem evoluir, ser alteradas ou descontinuadas, e avisaremos mudanças relevantes.</p>
        <p>O Harmonize+ é uma ferramenta de apoio à gestão e ao registro. Ele não presta atendimento de saúde, não substitui o julgamento do profissional e não oferece diagnóstico nem orientação clínica.</p>
      </Section>

      <Section id="conta" title="2. Conta e acesso">
        <List>
          <li>O cadastro exige informações verdadeiras e um e-mail válido, confirmado por código. Quem cria a clínica é o administrador principal; os demais usuários entram por convite.</li>
          <li>Você é responsável por manter sua senha e seus códigos de recuperação em sigilo e por tudo o que for feito com a sua conta. A verificação em duas etapas é obrigatória para administradores e recomendada a todos.</li>
          <li>Cada conta é pessoal. Não compartilhe o acesso: a clínica deve convidar cada profissional ou atendente com a sua própria conta e função.</li>
          <li>Avise-nos pelo contato abaixo se suspeitar de acesso indevido. Você pode encerrar sessões e dispositivos na tela de segurança da sua conta.</li>
        </List>
      </Section>

      <Section id="teste" title="3. Período de teste e condições comerciais">
        <p>Novas clínicas têm um período de teste gratuito de {TRIAL_DAYS} dias, contados do cadastro. Ao término do teste, o acesso às funcionalidades que exigem período ativo pode ser bloqueado. Eventuais condições comerciais, planos e preços serão informados antes de qualquer cobrança.</p>
      </Section>

      <Section id="clinica" title="4. Responsabilidades da clínica e dos usuários">
        <List>
          <li>A clínica é a controladora dos dados dos seus clientes/pacientes e responde por coletá-los de forma lícita, informar os titulares, apresentar a política de privacidade e obter os consentimentos e termos exigidos por lei e pelas normas do seu conselho profissional.</li>
          <li>Os registros clínicos, as decisões e os procedimentos são de responsabilidade dos profissionais habilitados, que devem estar regularmente inscritos no respectivo conselho profissional. O Harmonize+ não verifica essa habilitação nem a veracidade do que é registrado.</li>
          <li>A guarda e o prazo de conservação de prontuários e documentos clínicos exigidos por lei e pelas normas do conselho profissional são de responsabilidade da clínica.</li>
          <li>A clínica deve configurar os papéis e permissões da equipe de forma adequada, lembrando que dados clínicos ficam restritos às funções autorizadas.</li>
          <li>Os termos de consentimento modelo disponíveis no sistema são apenas pontos de partida e precisam ser revisados e aprovados pela clínica e por seus assessores clínicos e jurídicos antes do uso.</li>
          <li>Você deve manter os dados cadastrados corretos e atualizados e usar as automações (como e-mails ao paciente) apenas com contatos que possam recebê-las.</li>
        </List>
      </Section>

      <Section id="uso" title="5. Uso adequado">
        <p>É proibido usar o sistema para fins ilícitos; tentar acessar dados de outras clínicas ou contas; contornar controles de segurança, limites de tentativas ou permissões; enviar código malicioso; sobrecarregar a infraestrutura de forma abusiva; ou copiar, revender ou fazer engenharia reversa do sistema, salvo quando a lei permitir. Podemos suspender contas que violem estes Termos ou ameacem a segurança do serviço.</p>
      </Section>

      <Section id="google" title="6. Integração com o Google Agenda">
        <p>A conexão com o Google Agenda é opcional e depende da sua autorização na conta Google. Ao conectá-la, você autoriza o Harmonize+ a criar, atualizar e cancelar eventos de atendimento na agenda escolhida, nos termos descritos na <Link className={linkClass} href="/privacidade#agenda">Política de Privacidade</Link>. Você pode desconectar a qualquer momento no sistema ou nas permissões da sua conta Google. A agenda do Google é um serviço de terceiros, sujeito aos termos e à disponibilidade do próprio Google, e a sincronização pode atrasar ou falhar por motivos fora do nosso controle; o Harmonize+ continua sendo a referência dos agendamentos.</p>
        <p>Ao usar nomes de pacientes em eventos e convites, a clínica é responsável por considerar se isso é adequado ao seu contexto e por orientar a equipe sobre quais agendas conectar e quem as acessa.</p>
      </Section>

      <Section id="dados" title="7. Dados e propriedade">
        <p>Os dados inseridos pela clínica continuam sendo da clínica. Concedemos ao Harmonize+ apenas a autorização necessária para armazená-los e tratá-los para prestar o serviço, nos termos da Política de Privacidade. O sistema, a marca, o código e o conteúdo do Harmonize+ são protegidos por lei e não são transferidos a você por meio do uso.</p>
      </Section>

      <Section id="disponibilidade" title="8. Disponibilidade e segurança">
        <p>Adotamos medidas técnicas e organizacionais de segurança descritas na Política de Privacidade e trabalhamos para manter o sistema disponível, mas ele pode ficar indisponível por manutenção, falhas de provedores ou eventos fora do nosso controle. Recomendamos que a clínica mantenha seus próprios procedimentos para situações em que o sistema esteja inacessível.</p>
      </Section>

      <Section id="responsabilidade" title="9. Limitação de responsabilidade">
        <p>Dentro do que a lei permite, o Harmonize+ não responde por danos decorrentes de uso em desacordo com estes Termos, de informações incorretas inseridas pelos usuários, de decisões clínicas ou comerciais da clínica, de indisponibilidade de serviços de terceiros (como Google, e-mail e hospedagem) ou de acesso indevido causado por falha de guarda de credenciais pelo usuário. Nada nestes Termos limita direitos que a legislação, em especial a de defesa do consumidor, assegure e não possam ser afastados.</p>
      </Section>

      <Section id="encerramento" title="10. Encerramento, exportação e exclusão de dados">
        <p>Você pode parar de usar o sistema a qualquer momento. O administrador principal da clínica pode pedir o encerramento da conta ou da clínica pelo contato da seção 12; o pedido é tratado pela nossa equipe, com verificação da identidade de quem pede, porque o sistema ainda não tem uma tela para isso. O administrador principal pode, no próprio sistema, remover colaboradores da clínica; quando o colaborador não pertence a outra clínica, a conta dele é excluída.</p>
        <p><strong>Exportação:</strong> o sistema ainda não tem uma função de exportação completa dos dados. A clínica deve solicitá-la pelo contato antes do encerramento, e trataremos o pedido nos termos da lei. Orçamentos podem ser baixados em PDF pelo próprio sistema.</p>
        <p><strong>Exclusão e retenção:</strong> não há prazo automático de exclusão dos dados da clínica e dos pacientes. Após o encerramento, os dados são mantidos pelo tempo necessário para cumprir obrigações legais, resolver disputas e preservar a segurança, e depois podem ser excluídos ou anonimizados mediante solicitação, conforme descrito na <Link className={linkClass} href="/privacidade#retencao">Política de Privacidade</Link>.</p>
        <p>Podemos suspender ou encerrar contas em caso de violação destes Termos, conforme a seção 5.</p>
      </Section>

      <Section id="alteracoes" title="11. Alterações">
        <p>Podemos atualizar estes Termos. A data de atualização fica no topo da página e, em mudanças relevantes, avisaremos pelo sistema ou por e-mail. O uso continuado após o aviso indica concordância com a nova versão.</p>
      </Section>

      <Section id="lei" title="12. Lei aplicável, identificação e contato">
        <p>Estes Termos são regidos pelas leis da República Federativa do Brasil.</p>
        <LegalEntity />
      </Section>
    </LegalPage>
  );
}
