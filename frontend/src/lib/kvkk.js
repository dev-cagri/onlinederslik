// KVKK aydınlatma metni ve açık rıza. Metin değiştiğinde KVKK_VERSION'ı artırın;
// katılımcının onayladığı sürüm veritabanına (participant_verifications.kvkk_version) yazılır.
export const KVKK_VERSION = '2026-09-28.3';

const CONTROLLER = 'AbdulFettah Şahin';
const CONTACT = 'info@abdulfettah.com';
// Backend'deki VERIFICATION_RETENTION_DAYS ile aynı olmalı; kayıtlar bu süre sonunda otomatik silinir
const RETENTION_DAYS = 30;

export const KVKK_SECTIONS = [
  {
    title: 'Veri sorumlusu',
    body: `6698 sayılı Kişisel Verilerin Korunması Kanunu ("KVKK") kapsamında kişisel verileriniz, veri sorumlusu sıfatıyla ${CONTROLLER} tarafından aşağıda açıklanan şekilde işlenmektedir.`,
  },
  {
    title: 'İşlenen kişisel veriler',
    body: 'Kimlik (ad, soyad, T.C. kimlik numarası), iletişim (cep telefonu numarası), konum (derse katılım anındaki enlem/boylam ve doğruluk bilgisi) ve işlem güvenliği (IP adresi, tarayıcı bilgisi, doğrulama ve derse giriş zamanları) verileriniz.',
  },
  {
    title: 'İşleme amaçları',
    body: 'Derse katılan kişinin kimliğinin doğrulanması, yoklama ve katılım kaydının tutulması, derslere yetkisiz erişimin önlenmesi, bilgi güvenliğinin sağlanması ve yasal yükümlülüklerin yerine getirilmesi.',
  },
  {
    title: 'Toplama yöntemi ve hukuki sebep',
    body: 'Verileriniz bu ekrandaki formlar ve tarayıcınızın konum izni aracılığıyla elektronik ortamda toplanır. Verileriniz KVKK m.5/1, m.8/1 ve (yurt dışı numaralar için) m.9 uyarınca açık rızanıza dayanılarak işlenir ve aktarılır.',
  },
  {
    title: 'Aktarım',
    body: 'Cep telefonu numaranız, doğrulama kodunun gönderilmesi amacıyla SMS hizmet sağlayıcımız NETGSM İletişim ve Bilgi Teknolojileri A.Ş.\'ye aktarılır; yurt dışı numaralarda SMS, numaranın bulunduğu ülkedeki mobil operatörler aracılığıyla iletilir. Verileriniz ayrıca yasal zorunluluk hâlinde yetkili kamu kurum ve kuruluşlarıyla paylaşılabilir; bunun dışında üçüncü kişilere aktarılmaz.',
  },
  {
    title: 'Saklama süresi',
    body: `Verileriniz, doğrulamanın yapıldığı tarihten itibaren ${RETENTION_DAYS} gün boyunca saklanır; süre sonunda otomatik olarak silinir.`,
  },
  {
    title: 'Haklarınız',
    body: `KVKK m.11 uyarınca verilerinizin işlenip işlenmediğini öğrenme, bilgi talep etme, düzeltilmesini veya silinmesini isteme, aktarıldığı üçüncü kişileri bilme, itiraz etme ve zararın giderilmesini talep etme haklarına sahipsiniz. Başvurularınızı ${CONTACT} adresine iletebilirsiniz.`,
  },
];

export const KVKK_CONSENT_TEXT =
  'Kimlik (ad, soyad, T.C. kimlik no), iletişim (cep telefonu) ve konum verilerimin derse katılımımın ' +
  'doğrulanması ve yoklama amacıyla işlenmesine ve telefon numaramın SMS doğrulaması için ' +
  'NETGSM\'e ve yurt dışı numaralarda ilgili ülkedeki operatörlere aktarılmasına açık rıza veriyorum.';
