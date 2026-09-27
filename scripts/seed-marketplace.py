# ShopEye preview marketplace, part 2: departments, sub-categories, brands, preview sellers and ~150 products.
# Photos: Unsplash (free licence), vetted by hand; credits stored per photo.
import json, random
random.seed(7)
rows = {l.split(':',1)[0]: [e.split('/') for e in l.strip().split(':',1)[1].split(',')] for l in open('scripts/preview-photos.txt')}
picks = {l.split(':')[0]: [int(x) for x in l.strip().split(':')[1].split(',')] for l in open('scripts/preview-photo-picks.txt') if l.strip() and not l.startswith('#')}
def photos(k): return [rows[k][i] for i in picks[k]]

DEPTS = [('fashion','Fashion'),('electronics','Electronics'),('home-living','Home & Living'),('beauty-personal-care','Beauty & Personal Care'),
         ('appliances','Appliances'),('grocery','Grocery'),('sports-outdoors','Sports & Outdoors'),('toys-kids','Toys & Kids'),
         ('automotive','Automotive'),('books-stationery','Books & Stationery')]
# existing sub-categories move under departments (slug -> dept, new name or None)
MOVE = {'sarees':('fashion',None),'kurtas-kurtis':('fashion','Kurtis & Suits'),'dupattas-stoles':('fashion',None),'menswear':('fashion',None),
        'jewellery':('fashion',None),'home-decor':('home-living',None),'handicrafts':('home-living',None),'beauty-wellness':('beauty-personal-care','Wellness & Ayurveda')}
SUBS = [  # slug, name, dept, gst, return days, sort
 ('dresses','Dresses','fashion',5,7),('tops','Tops','fashion',5,7),('jeans','Jeans','fashion',12,7),('footwear','Footwear','fashion',12,7),
 ('bags','Bags','fashion',18,7),('watches','Watches','fashion',18,7),
 ('audio','Audio','electronics',18,7),('computer-accessories','Computer Accessories','electronics',18,7),('smart-wearables','Smart Wearables','electronics',18,7),
 ('kitchen-dining','Kitchen & Dining','home-living',12,7),('cookware','Cookware','home-living',12,7),('bedding','Bedding','home-living',12,7),
 ('skin-hair','Skin & Hair Care','beauty-personal-care',18,0),('fragrances','Fragrances','beauty-personal-care',18,0),
 ('small-appliances','Small Appliances','appliances',18,7),
 ('spices-staples','Spices & Staples','grocery',5,0),('tea-coffee','Tea & Coffee','grocery',5,0),
 ('fitness','Fitness','sports-outdoors',12,7),('cricket','Cricket','sports-outdoors',12,7),
 ('toys','Toys','toys-kids',12,7),('car-accessories','Car Accessories','automotive',18,7),
 ('notebooks-journals','Notebooks & Journals','books-stationery',12,7),('books','Books','books-stationery',0,7),('art-supplies','Art Supplies','books-stationery',12,7)]
BRANDS = ['Rangvi','Tantuka','Nayra Loom','Voltrix','Mittikala','Aangan Home','Suvasa','Khetika Farms','Chaiyaan','Khelwise','DriveNest','Pannaa','Chitrakala','Kaalchakra','Padma Steps']
SELLERS = [  # key, display name, legal suffix, tagline, pincode
 ('rangvi','Rangvi Fashion House','Fashion & ethnic wear','560034'),('voltrix','Voltrix Store','Electronics & gadgets','560066'),
 ('aangan','Aangan Home Studio','Home, kitchen & decor','560038'),('khetika','Khetika Farms','Grocery, beauty & wellness','560095'),
 ('pannaa','Pannaa Books & Play','Books, toys, sports & more','560102')]
P = []
def add(cat, seller, brand, titles, desc, hsn, gst, price_rng, key, attrs_fn, specs, alt_word):
    ph = photos(key)
    for i, t in enumerate(titles):
        if i >= len(ph): break
        pid, user = ph[i]
        price = random.randrange(price_rng[0], price_rng[1], 50) - 1
        mrp = int(round(price * random.choice([1.25, 1.35, 1.5, 1.6, 2.0]) / 50) * 50 - 1)
        a = attrs_fn(i)
        P.append(dict(cat=cat, seller=seller, brand=brand, title=t, desc=desc(t), hsn=hsn, gst=gst, mrp=max(mrp, price + 50), price=price,
                      photo=pid, user=user, attrs=a, specs={**specs, **({'Colour': a['colour']} if 'colour' in a else {})}, alt=f'{alt_word}: {t}'))
S = ['S','M','L','XL']; C = lambda *c: (lambda i: {'size': S[i % 4], 'colour': c[i % len(c)]})
add('dresses','rangvi','Rangvi',['Floral Print Midi Dress','Red Polka Sundress','Tiered Maxi Dress, Blush','Printed Wrap Dress','Floral Tie-Waist Dress'],
    lambda t: f'{t} in soft, breathable fabric with a flattering fit for day or evening.','6204',5,(999,2499),'dress',C('Ivory','Red','Blush','White','Black'),{'Fabric':'Viscose rayon','Care':'Hand wash cold'},'Dress')
add('tops','rangvi','Tantuka',['V-Neck Crepe Top, Scarlet','Floral Tie-Neck Shirt','Printed Bell-Sleeve Top','Classic White Shirt','Cream Flutter Blouse'],
    lambda t: f'{t}, easy to pair with jeans, trousers or skirts.','6206',5,(599,1499),'tops',C('Red','Pink','Multicolour','White','Cream'),{'Fabric':'Cotton blend','Care':'Machine wash cold'},'Top')
add('jeans','rangvi','Tantuka',['Straight Fit Jeans, Mid Blue','Skinny Jeans, Indigo','Wide Leg Jeans','High Rise Mom Jeans','Classic Blue Denim'],
    lambda t: f'{t} in stretch denim for all-day comfort.','6204',12,(999,1999),'jeans',lambda i: {'size': ['28','30','32','34'][i % 4], 'colour': ['Mid Blue','Indigo','Light Blue','Blue','Dark Blue'][i]},{'Fabric':'Cotton denim, 2% elastane','Rise':'Mid','Care':'Wash inside out'},'Jeans')
add('footwear','rangvi','Padma Steps',['Strappy Block Heels, Nude','Classic Pumps, Black','Red Party Heels','Ankle Boots, Blush','Pointed Stilettos, Black'],
    lambda t: f'{t} with a cushioned insole for comfort.','6404',12,(999,2499),'heels',lambda i: {'size': ['UK 4','UK 5','UK 6','UK 7','UK 5'][i], 'colour': ['Nude','Black','Red','Blush','Black'][i]},{'Upper':'Synthetic leather','Sole':'TPR'},'Footwear')
add('bags','rangvi','Nayra Loom',['Structured Satchel, Grey','Leather Duffle Bag, Black','Vintage Messenger Bag, Tan','Tan Leather Tote','Top-Handle Bag, Brown','Quilted Handbag, Blush'],
    lambda t: f'{t} with sturdy stitching and roomy compartments.','4202',18,(1299,3499),'bags',lambda i: {'size': 'One size', 'colour': ['Grey','Black','Tan','Tan','Brown','Blush'][i]},{'Material':'Vegan leather','Closure':'Zip'},'Bag')
add('watches','rangvi','Kaalchakra',['Chronograph Watch, Leather Strap','Minimal Dial Watch, Black','Steel Bracelet Watch, Blue Dial','Rose Gold Analog Watch','Classic Watch, Green Dial'],
    lambda t: f'{t} with water resistance for everyday wear.','9102',18,(1499,3999),'watch',lambda i: {'size': 'One size', 'colour': ['Brown','Black','Silver','Rose gold','Green'][i]},{'Movement':'Quartz','Water resistance':'30 m','Warranty':'1 year'},'Watch')
add('audio','voltrix','Voltrix',['Wireless Earbuds with Charging Case','Sport Earbuds, Black','Noise-Isolating Earbuds'],
    lambda t: f'{t} with Bluetooth 5.3 and up to 24 hours total playback.','8518',18,(1299,2999),'earbuds',lambda i: {'colour': ['Black','Black','Midnight'][i]},{'Connectivity':'Bluetooth 5.3','Battery':'Up to 24 h with case','Warranty':'1 year'},'Earbuds')
add('audio','voltrix','Voltrix',['Portable Party Speaker','RGB Bluetooth Speaker','Compact Speaker, Grey','Desk Speaker, Black','Travel Speaker with Strap'],
    lambda t: f'{t} with rich sound and up to 12 hours of battery.','8518',18,(1499,3999),'speaker',lambda i: {'colour': ['Black','Black','Grey','Black','Grey'][i]},{'Connectivity':'Bluetooth 5.0','Battery':'Up to 12 h','Warranty':'1 year'},'Speaker')
add('computer-accessories','voltrix','Voltrix',['Compact Mechanical Keyboard','Mechanical Keyboard, Tan Keys','Pastel Keycap Keyboard','Retro Keyboard, White & Orange','Low-Profile Wireless Keyboard'],
    lambda t: f'{t} with tactile switches for comfortable typing.','8471',18,(1999,4999),'keyboard',lambda i: {'colour': ['Black','Black','Pastel','White','Black'][i]},{'Connection':'USB-C / Bluetooth','Switches':'Tactile','Warranty':'1 year'},'Keyboard')
add('smart-wearables','voltrix','Voltrix',['Fitness Band, White','Smartwatch with AMOLED Display','Smartwatch, Black','Smartwatch, Silver'],
    lambda t: f'{t} with heart-rate, sleep and step tracking.','8517',18,(1999,4999),'smartwatch',lambda i: {'colour': ['White','Green','Black','Silver'][i]},{'Battery':'Up to 7 days','Water resistance':'IP68','Warranty':'1 year'},'Smartwatch')
add('kitchen-dining','aangan','Aangan Home',['Stoneware Dinner Set, Sand','Ceramic Serving Set','Matte Dinner Plates (Set of 4)','Handpainted Dinner Set','Stoneware Bowls (Set of 4)','Glazed Mug Set'],
    lambda t: f'{t}, microwave and dishwasher safe.','6912',12,(799,2999),'kitchen',lambda i: {'colour': ['Sand','White','White','Multicolour','Brown','Teal'][i]},{'Material':'Stoneware','Microwave safe':'Yes'},'Dinnerware')
add('cookware','aangan','Aangan Home',['Non-Stick Frying Pan, 24 cm','Cast Iron Skillet, 26 cm','Cast Iron Cookware Set','Pre-Seasoned Tawa','Cast Iron Kadai'],
    lambda t: f'{t} that heats evenly and works on gas and induction.','7323',12,(699,2999),'cookware',lambda i: {'colour': 'Black'},{'Material':'Cast iron / non-stick','Induction':'Yes'},'Cookware')
add('bedding','aangan','Suvasa',['Cotton Bedsheet Set, White','Percale Duvet Cover','Linen Bedding Set, Ivory','Ruffled Pillow Covers (Pair)','Washed Cotton Bedsheet'],
    lambda t: f'{t} in soft, breathable cotton.','6302',12,(999,2999),'bedding',lambda i: {'size': ['Queen','Queen','King','Standard','Double'][i], 'colour': ['White','White','Ivory','Cream','White'][i]},{'Material':'100% cotton','Thread count':'300'},'Bedding')
add('fragrances','khetika','Suvasa',['Eau de Parfum, Amber','Eau de Parfum, Oud','Perfume Gift Set','Eau de Toilette, Citrus'],
    lambda t: f'{t}, long-lasting and alcohol-light.','3303',18,(799,2499),'perfume',lambda i: {'size': ['50 ml','100 ml','4 x 10 ml','100 ml'][i]},{'Type':'Fragrance','Longevity':'6–8 hours'},'Fragrance')
add('skin-hair','khetika','Suvasa',['Rose Quartz Face Roller','Vitamin C Face Serum','Face Serum & Roller Kit','Aloe Face Mist'],
    lambda t: f'{t} for a simple daily skincare routine.','3304',18,(399,1499),'skincare',lambda i: {'size': ['One size','30 ml','Kit','100 ml'][i]},{'Skin type':'All','Cruelty free':'Yes'},'Skincare')
add('small-appliances','aangan','Aangan Home',['Electric Kettle, 1.7 L','Glass Electric Kettle','Glass Kettle with Warm Mode'],
    lambda t: f'{t} with auto shut-off and boil-dry protection.','8516',18,(999,2499),'kettle',lambda i: {'colour': ['Black','Clear','Clear'][i]},{'Power':'1500 W','Warranty':'1 year'},'Kettle')
add('small-appliances','aangan','Aangan Home',['Rechargeable Desk Fan, Teal','Metal Table Fan','Mini USB Fan, Pink','Clip Fan, Black','Handheld Fan, White'],
    lambda t: f'{t} with three speeds and a quiet motor.','8414',18,(599,1999),'fan',lambda i: {'colour': ['Teal','Silver','Pink','Black','White'][i]},{'Speeds':'3','Warranty':'1 year'},'Fan')
add('spices-staples','khetika','Khetika Farms',['Masala Dabba with 7 Spices','Whole Spices Combo','Everyday Masala Box','Kitchen Spice Set','Spice Starter Pack'],
    lambda t: f'{t}, sourced from Indian farms and packed fresh.','0910',5,(299,999),'spices',lambda i: {'size': ['7 x 50 g','6 x 100 g','500 g','8 x 50 g','5 x 100 g'][i]},{'Shelf life':'12 months','Origin':'India'},'Spices')
add('spices-staples','khetika','Khetika Farms',['Premium Basmati Rice, 5 kg','Sona Masoori Rice, 5 kg','Aged Basmati Rice, 1 kg','Brown Basmati Rice, 1 kg'],
    lambda t: f'{t}, aged for aroma and long grains.','1006',5,(149,899),'rice',lambda i: {'size': ['5 kg','5 kg','1 kg','1 kg'][i]},{'Origin':'India','Shelf life':'12 months'},'Rice')
add('tea-coffee','khetika','Chaiyaan',['Assam CTC Tea, 500 g','Darjeeling Loose Leaf Tea','Masala Chai Blend','Green Tea with Tulsi'],
    lambda t: f'{t}, packed fresh from Indian estates.','0902',5,(249,799),'tea',lambda i: {'size': ['500 g','100 g','250 g','100 g'][i]},{'Origin':'India'},'Tea')
add('tea-coffee','khetika','Chaiyaan',['Chikmagalur Coffee Beans, 500 g','Filter Coffee Powder','Medium Roast Beans, 250 g','Arabica Coffee Beans, 1 kg'],
    lambda t: f'{t} from Karnataka estates, roasted in small batches.','0901',5,(299,1299),'coffee',lambda i: {'size': ['500 g','250 g','250 g','1 kg'][i]},{'Origin':'Karnataka','Roast':'Medium'},'Coffee')
add('fitness','pannaa','Khelwise',['Yoga Block Set (Pair)','Anti-Slip Yoga Mat, 6 mm','Yoga Mat, Charcoal','Yoga Starter Kit'],
    lambda t: f'{t} for home workouts and studio practice.','9506',12,(499,1499),'yoga',lambda i: {'colour': ['Cork','Green','Charcoal','Pink'][i]},{'Material':'TPE / cork'},'Yoga')
add('fitness','pannaa','Khelwise',['Hex Dumbbells, 5 kg Pair','Rubber Hex Dumbbell, 10 kg','Dumbbell Set, 2 x 7.5 kg','Hex Dumbbells, 2.5 kg Pair'],
    lambda t: f'{t} with knurled grips.','9506',12,(999,3999),'dumbbell',lambda i: {'size': ['5 kg x 2','10 kg','7.5 kg x 2','2.5 kg x 2'][i]},{'Material':'Rubber-coated iron'},'Dumbbells')
add('cricket','pannaa','Khelwise',['Leather Cricket Ball, Red','Match Ball, Red','Training Ball, Red','Tournament Ball, Orange'],
    lambda t: f'{t}, hand-stitched with a four-piece leather cover.','9506',12,(299,999),'cricket',lambda i: {'size': 'Standard'},{'Material':'Leather','Weight':'156 g'},'Cricket ball')
add('toys','pannaa','Khelwise',['Wooden Stacking Rings','Wooden Animal Puzzle','Wooden Race Cars (Set of 4)','Alphabet Wooden Blocks','Wooden House Set','Rainbow Sorting Bowls'],
    lambda t: f'{t} made from child-safe, non-toxic finishes.','9503',12,(399,1299),'toys',lambda i: {'size': '3+ years'},{'Material':'Wood','Age':'3+ years'},'Toy')
add('toys','pannaa','Khelwise',['Classic Teddy Bear, 30 cm','Teddy with Bow Tie','Soft Teddy, Large','Cuddly Teddy, Grey','Vintage Teddy Bear'],
    lambda t: f'{t}, extra soft and gift-ready.','9503',12,(499,1499),'plush',lambda i: {'size': ['30 cm','25 cm','45 cm','30 cm','35 cm'][i]},{'Material':'Plush polyester','Age':'All ages'},'Teddy')
add('toys','pannaa','Khelwise',['Rainbow Building Bricks','Creative Brick Set'],
    lambda t: f'{t} for creative play.','9503',12,(599,1499),'blocks',lambda i: {'size': '4+ years'},{'Pieces':'120','Age':'4+ years'},'Building bricks')
add('car-accessories','pannaa','DriveNest',['Leatherette Seat Cover Set','Car Seat Organiser','Console Organiser Tray'],
    lambda t: f'{t} with universal fit for most hatchbacks and sedans.','8708',18,(499,3999),'car',lambda i: {'colour': ['Black','Brown','Black'][i]},{'Fit':'Universal'},'Car accessory')
add('car-accessories','pannaa','DriveNest',['Wheel Cleaning Brush Kit','Car Wash Mitt & Microfibre Set','Tyre Shine & Detailing Kit'],
    lambda t: f'{t} for a safe, scratch-free clean.','9603',18,(399,1499),'carcare',lambda i: {'size': 'Kit'},{'Includes':'Brush, mitt, cloths'},'Car care')
add('notebooks-journals','pannaa','Pannaa',['Dotted Spiral Notebook, A5','Hardbound Ruled Journal','Blue Hardcover Notebook','Spiral Ruled Notepad','Grid Notebook, A5','Classic Black Journal'],
    lambda t: f'{t} with 100 gsm paper that takes ink without bleeding.','4820',12,(199,699),'notebook',lambda i: {'size': 'A5'},{'Paper':'100 gsm','Pages':'192'},'Notebook')
add('books','pannaa','Pannaa',['Classic Short Stories (Paperback)','Poetry Anthology (Paperback)','Indian Folk Tales Collection','Readers’ Box Set'],
    lambda t: f'{t} — a preview listing while publishers join ShopEye.','4901',0,(199,999),'books',lambda i: {'size': 'Paperback'},{'Language':'English','Binding':'Paperback'},'Books')
add('art-supplies','pannaa','Chitrakala',['Watercolour Sketchbook, A4','Watercolour Paint Set, 24 Colours','Spiral Sketch Pad','Botanical Sketching Kit','Premium Drawing Pad'],
    lambda t: f'{t} for artists and hobbyists.','4820',12,(299,1499),'sketch',lambda i: {'size': 'A4'},{'Paper':'200 gsm'},'Art supplies')
print(len(P), 'products')
json.dump(dict(depts=DEPTS, move=MOVE, subs=SUBS, brands=BRANDS, sellers=SELLERS, products=P), open('/tmp/marketplace.json','w'), ensure_ascii=False)
