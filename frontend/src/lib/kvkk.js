// KVKK aydınlatma metni ve açık rıza. Metin değiştiğinde KVKK_VERSION'ı artırın;
// üyenin her girişte onayladığı sürüm veritabanına (members.kvkk_version) yazılır.
export const KVKK_VERSION = '2026-09-29.1';

const CONTROLLER = 'AbdulFettah Şahin';
const CONTACT = 'info@abdulfettah.com';
// Backend'deki ATTENDANCE_RETENTION_DAYS ile aynı olmalı; yoklama kayıtları bu süre sonunda otomatik silinir
const ATTENDANCE_RETENTION_DAYS = 30;

export const KVKK_SECTIONS = [
  {
    title: 'Veri sorumlusu',
    body: `6698 sayılı Kişisel Verilerin Korunması Kanunu ("KVKK") kapsamında kişisel verileriniz, veri sorumlusu sıfatıyla ${CONTROLLER} tarafından aşağıda açıklanan şekilde işlenmektedir.`,
  },
  {
    title: 'İşlenen kişisel veriler',
    body: 'Kimlik (ad, soyad), iletişim (SMS ile giriş yapıyorsanız cep telefonu numarası) ve işlem güvenliği (IP adresi, tarayıcı bilgisi, giriş ve toplantıya katılım zamanları) verileriniz.',
  },
  {
    title: 'İşleme amaçları',
    body: 'Üyeliğinizin oluşturulması ve telefon numaranız ya da size verilen giriş koduyla güvenli giriş yapmanız, üyeliğinizin yönetici tarafından onaylanması, katılım kaydının tutulması, toplantılara yetkisiz erişimin önlenmesi, bilgi güvenliğinin sağlanması ve yasal yükümlülüklerin yerine getirilmesi.',
  },
  {
    title: 'Toplama yöntemi ve hukuki sebep',
    body: 'Verileriniz bu ekrandaki formlar aracılığıyla elektronik ortamda toplanır. Verileriniz KVKK m.5/1, m.8/1 ve (yurt dışı numaralar için) m.9 uyarınca açık rızanıza dayanılarak işlenir ve aktarılır.',
  },
  {
    title: 'Aktarım',
    body: 'Cep telefonu numaranız, giriş kodunun gönderilmesi amacıyla SMS hizmet sağlayıcımız NETGSM İletişim ve Bilgi Teknolojileri A.Ş.\'ye aktarılır; yurt dışı numaralarda SMS, numaranın bulunduğu ülkedeki mobil operatörler aracılığıyla iletilir. Verileriniz ayrıca yasal zorunluluk hâlinde yetkili kamu kurum ve kuruluşlarıyla paylaşılabilir; bunun dışında üçüncü kişilere aktarılmaz.',
  },
  {
    title: 'Saklama süresi',
    body: `Üyelik bilgileriniz (ad, soyad ve varsa telefon) üyeliğiniz devam ettiği sürece saklanır ve silinmesini talep ettiğinizde silinir. Toplantıya katılım kayıtları ${ATTENDANCE_RETENTION_DAYS} gün sonra, tamamlanmamış üyelik kayıtları 24 saat sonra otomatik olarak silinir.`,
  },
  {
    title: 'Haklarınız',
    body: `KVKK m.11 uyarınca verilerinizin işlenip işlenmediğini öğrenme, bilgi talep etme, düzeltilmesini veya silinmesini isteme, aktarıldığı üçüncü kişileri bilme, itiraz etme ve zararın giderilmesini talep etme haklarına sahipsiniz. Başvurularınızı ${CONTACT} adresine iletebilirsiniz.`,
  },
];

export const KVKK_CONSENT_TEXT =
  'Aydınlatma metnini okudum. Ad, soyad ve cep telefonu numaramın üyelik, giriş doğrulaması ve ' +
  'katılım kaydı amacıyla işlenmesine ve telefon numaramın SMS ile giriş kodu gönderimi için NETGSM\'e ' +
  've yurt dışı numaralarda ilgili ülkedeki operatörlere aktarılmasına açık rıza veriyorum.';

// Giriş koduyla üyelikte telefon alınmaz; rıza yalnız ad/soyad ve işlem kayıtları için
export const KVKK_CODE_CONSENT_TEXT =
  'Aydınlatma metnini okudum. Ad ve soyadımın üyelik ve katılım kaydı amacıyla işlenmesine açık rıza veriyorum.';

// SMS doğrulaması kapalıyken telefon numarası SMS sağlayıcısına aktarılmaz
export const KVKK_PHONE_CONSENT_TEXT =
  'Aydınlatma metnini okudum. Ad, soyad ve cep telefonu numaramın üyelik ve katılım kaydı ' +
  'amacıyla işlenmesine açık rıza veriyorum.';
